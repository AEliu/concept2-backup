import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const backup = readFileSync(new URL('../../.github/workflows/backup.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const history = readFileSync(new URL('../../.github/workflows/download-full-history.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const pushScript = readFileSync(new URL('../../.github/scripts/push-backup.sh', import.meta.url), 'utf8');

function namedStep(workflow, name) {
  const steps = [...workflow.matchAll(/^      - name: (.+)$/gm)];
  const index = steps.findIndex((match) => match[1] === name);
  assert.notEqual(index, -1, `Missing step: ${name}`);
  const start = steps[index].index;
  return workflow.slice(start, steps[index + 1]?.index ?? workflow.length);
}

test('Concept2 credential is exposed only to API calling steps', () => {
  for (const [workflow, allowed] of [
    [backup, new Set([
      'Validate Concept2 Access Token',
      'Download single activity (repository dispatch)',
      'Download single activity (manual trigger)',
      'Download full history (manual trigger)',
      'Download day activities (manual trigger)',
      "Reconcile yesterday's activities (scheduled)"
    ])],
    [history, new Set(['Validate Concept2 Access Token', 'Download full workout history'])]
  ]) {
    assert.doesNotMatch(workflow, /C2_ACCESS_TOKEN[^\n]*GITHUB_ENV|GITHUB_ENV[^\n]*C2_ACCESS_TOKEN/);
    const names = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
    for (const name of names) {
      const step = namedStep(workflow, name);
      assert.equal(step.includes('C2_ACCESS_TOKEN: ${{ secrets.C2_ACCESS_TOKEN }}'), allowed.has(name), name);
    }
    assert.equal((workflow.match(/C2_ACCESS_TOKEN: \$\{\{ secrets\.C2_ACCESS_TOKEN \}\}/g) ?? []).length, allowed.size);
  }
  assert.doesNotMatch(namedStep(backup, 'Record deleted activity (repository dispatch)'), /C2_ACCESS_TOKEN/);
  assert.match(namedStep(backup, 'Validate Concept2 Access Token'), /event_type == 'result-added' \|\| github\.event\.client_payload\.event_type == 'result-updated'/);
});

test('checkout credentials are disabled and the write token reaches only the push step', () => {
  for (const workflow of [backup, history]) {
    assert.match(namedStep(workflow, 'Checkout code'), /persist-credentials: false/);
    const push = namedStep(workflow, 'Push changes');
    assert.match(push, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    for (const match of workflow.matchAll(/^      - name: (.+)$/gm)) {
      if (match[1] !== 'Push changes' && match[1] !== 'Validate digest and check completed webhook marker') {
        assert.doesNotMatch(namedStep(workflow, match[1]), /GH_TOKEN: \$\{\{ github\.token \}\}/);
      }
    }
  }
  assert.match(pushScript, /gh auth setup-git --hostname github\.com/);
  assert.match(pushScript, /\$\{GH_TOKEN:\?GH_TOKEN is required to push the backup\}/);
});

test('queued writers check out the current branch head instead of the event SHA', () => {
  const lock = /concurrency:\s+group: c2-backup-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}\s+cancel-in-progress: false\s+queue: max/;
  for (const workflow of [backup, history]) {
    assert.match(workflow, lock);
    const checkout = namedStep(workflow, 'Checkout code');
    assert.match(checkout, /ref: \$\{\{ github\.ref \}\}/);
    assert.doesNotMatch(checkout, /github\.sha|GITHUB_SHA|github\.ref_name/);
  }
  assert.match(backup, /backup-and-build:\n    needs: webhook-preflight\n    if: \$\{\{ !cancelled\(\) && github\.ref_type == 'branch' &&/);
  assert.match(history, /download-history:\n    if: github\.ref_type == 'branch'/);
});

test('all external actions are pinned and jobs have only their required token permissions', () => {
  for (const workflow of [backup, history]) {
    const actions = [...workflow.matchAll(/^\s+uses: ([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(actions.length > 0);
    for (const action of actions) assert.match(action, /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/);
    assert.match(workflow, /^permissions: \{\}$/m);
    assert.doesNotMatch(workflow, /ad-m\/github-push-action|@master/);
  }
  assert.match(backup, /  webhook-preflight:[\s\S]*?    permissions:\n      actions: read\n/);
  assert.match(backup, /  backup-and-build:[\s\S]*?    permissions:\n      contents: write\n/);
  assert.match(backup, /  deploy-pages:[\s\S]*?    permissions:\n      pages: write\n      id-token: write\n/);
  assert.match(backup, /  mark-webhook-complete:[\s\S]*?    permissions: \{\}\n/);
  assert.match(history, /  download-history:[\s\S]*?    permissions:\n      contents: write\n/);
});

test('both writers use the same queue and bounded non-force push routine', () => {
  const lock = /concurrency:\s+group: c2-backup-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}\s+cancel-in-progress: false\s+queue: max/;
  for (const workflow of [backup, history]) {
    assert.match(workflow, lock);
    assert.match(namedStep(workflow, 'Push changes'), /run: bash \.github\/scripts\/push-backup\.sh/);
  }
  assert.match(pushScript, /for attempt in 1 2 3/);
  assert.match(pushScript, /git fetch origin/);
  assert.match(pushScript, /git rebase/);
  assert.match(pushScript, /git push origin/);
  assert.doesNotMatch(pushScript, /--force|-f\b|reset --hard/);
});

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test('push routine rebases an independent remote commit before publishing backup', () => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  if (!existsSync(bash) && process.platform === 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'c2-push-test-'));
  try {
    const remote = join(root, 'remote.git');
    const seed = join(root, 'seed');
    const backupClone = join(root, 'backup');
    const otherClone = join(root, 'other');
    run('git', ['init', '--bare', remote], root);
    run('git', ['init', '-b', 'main', seed], root);
    run('git', ['config', 'user.email', 'test@example.test'], seed);
    run('git', ['config', 'user.name', 'Test'], seed);
    writeFileSync(join(seed, 'base.txt'), 'base\n');
    run('git', ['add', 'base.txt'], seed);
    run('git', ['commit', '-m', 'initial'], seed);
    run('git', ['remote', 'add', 'origin', remote], seed);
    run('git', ['push', 'origin', 'main'], seed);
    run('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
    run('git', ['clone', remote, backupClone], root);
    run('git', ['clone', remote, otherClone], root);
    for (const clone of [backupClone, otherClone]) {
      run('git', ['config', 'user.email', 'test@example.test'], clone);
      run('git', ['config', 'user.name', 'Test'], clone);
    }
    writeFileSync(join(backupClone, 'backup.txt'), 'workout\n');
    run('git', ['add', 'backup.txt'], backupClone);
    run('git', ['commit', '-m', 'backup'], backupClone);
    run('git', ['checkout', '--detach'], backupClone);
    writeFileSync(join(otherClone, 'other.txt'), 'concurrent\n');
    run('git', ['add', 'other.txt'], otherClone);
    run('git', ['commit', '-m', 'other'], otherClone);
    run('git', ['push', 'origin', 'main'], otherClone);

    const result = spawnSync(bash, ['-s'], {
      cwd: backupClone,
      env: { ...process.env, GITHUB_REF_NAME: 'main' },
      input: pushScript,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], backupClone).includes('backup.txt'));
    run('git', ['fetch', 'origin', 'main'], otherClone);
    const files = run('git', ['ls-tree', '-r', '--name-only', 'origin/main'], otherClone);
    assert.match(files, /backup\.txt/);
    assert.match(files, /other\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('push routine aborts a conflicting rebase without overwriting the remote', () => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  if (!existsSync(bash) && process.platform === 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'c2-push-conflict-'));
  try {
    const remote = join(root, 'remote.git');
    const seed = join(root, 'seed');
    const backupClone = join(root, 'backup');
    const otherClone = join(root, 'other');
    run('git', ['init', '--bare', remote], root);
    run('git', ['init', '-b', 'main', seed], root);
    run('git', ['config', 'user.email', 'test@example.test'], seed);
    run('git', ['config', 'user.name', 'Test'], seed);
    writeFileSync(join(seed, 'shared.txt'), 'base\n');
    run('git', ['add', 'shared.txt'], seed);
    run('git', ['commit', '-m', 'initial'], seed);
    run('git', ['remote', 'add', 'origin', remote], seed);
    run('git', ['push', 'origin', 'main'], seed);
    run('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
    run('git', ['clone', remote, backupClone], root);
    run('git', ['clone', remote, otherClone], root);
    for (const clone of [backupClone, otherClone]) {
      run('git', ['config', 'user.email', 'test@example.test'], clone);
      run('git', ['config', 'user.name', 'Test'], clone);
    }
    writeFileSync(join(backupClone, 'shared.txt'), 'backup\n');
    run('git', ['add', 'shared.txt'], backupClone);
    run('git', ['commit', '-m', 'backup'], backupClone);
    run('git', ['checkout', '--detach'], backupClone);
    writeFileSync(join(otherClone, 'shared.txt'), 'other\n');
    run('git', ['add', 'shared.txt'], otherClone);
    run('git', ['commit', '-m', 'other'], otherClone);
    run('git', ['push', 'origin', 'main'], otherClone);
    const remoteBefore = run('git', ['rev-parse', 'refs/heads/main'], remote);

    const result = spawnSync(bash, ['-s'], {
      cwd: backupClone,
      env: { ...process.env, GITHUB_REF_NAME: 'main' },
      input: pushScript,
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Backup changes conflict with the remote branch/);
    assert.equal(run('git', ['rev-parse', 'refs/heads/main'], remote), remoteBefore);
    const rebaseHead = spawnSync('git', ['rev-parse', '--verify', 'REBASE_HEAD'], {
      cwd: backupClone,
      encoding: 'utf8'
    });
    assert.notEqual(rebaseHead.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
