import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/backup.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

function job(name, nextName) {
  return workflow.split(`  ${name}:`)[1].split(`  ${nextName}:`)[0];
}

test('schedule runs the queued branch backup while duplicate webhooks remain skipped', () => {
  assert.match(workflow, /schedule:\n    - cron: '15 19 \* \* \*'/);
  assert.match(workflow, /group: c2-backup-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}\s+cancel-in-progress: false\s+queue: max/);
  assert.match(job('webhook-preflight', 'backup-and-build'), /if: github\.event_name == 'repository_dispatch'/);

  const backup = job('backup-and-build', 'deploy-pages');
  const gate = backup.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.equal(gate,
    "!cancelled() && github.ref_type == 'branch' && (github.event_name == 'workflow_dispatch' || github.event_name == 'schedule' || (needs.webhook-preflight.result == 'success' && needs.webhook-preflight.outputs.duplicate == 'false'))");

  for (const [scenario, event, branch, preflight, duplicate, cancelled, expected] of [
    ['scheduled default branch', 'schedule', true, 'skipped', '', false, true],
    ['manual default branch', 'workflow_dispatch', true, 'skipped', '', false, true],
    ['new webhook', 'repository_dispatch', true, 'success', 'false', false, true],
    ['duplicate webhook', 'repository_dispatch', true, 'success', 'true', false, false],
    ['failed webhook preflight', 'repository_dispatch', true, 'failure', '', false, false],
    ['non-branch trigger', 'schedule', false, 'skipped', '', false, false],
    ['cancelled schedule', 'schedule', true, 'skipped', '', true, false],
    ['cancelled manual', 'workflow_dispatch', true, 'skipped', '', true, false]
  ]) {
    const runs = !cancelled && branch && (event === 'workflow_dispatch' || event === 'schedule'
      || (preflight === 'success' && duplicate === 'false'));
    assert.equal(runs, expected, scenario);
  }
});

test('scheduled step computes Shanghai yesterday and cannot publish a partial backup', () => {
  const backup = job('backup-and-build', 'deploy-pages');
  const step = backup.split("      - name: Reconcile yesterday's activities (scheduled)")[1]
    .split('\n      - name:')[0];
  assert.match(step, /if: github\.event_name == 'schedule'/);
  assert.match(step, /C2_ACCESS_TOKEN: \$\{\{ secrets\.C2_ACCESS_TOKEN \}\}/);
  assert.match(step, /set -euo pipefail/);
  assert.match(step, /WORKOUT_DATE="\$\(TZ=Asia\/Shanghai date -d 'yesterday' \+%F\)"/);
  assert.match(step, /uv run download_history\.py --date "\$WORKOUT_DATE"/);
  assert.doesNotMatch(step, /github\.event\.inputs|continue-on-error/);
  assert.doesNotMatch(step.slice(step.indexOf('        run: |')), /\$\{\{/);

  const deploy = job('deploy-pages', 'mark-webhook-complete');
  assert.match(deploy, /if: \$\{\{ !cancelled\(\) && needs\.backup-and-build\.result == 'success' \}\}/);
  const marker = workflow.split('  mark-webhook-complete:')[1];
  assert.match(marker, /if: \$\{\{ github\.event_name == 'repository_dispatch'/);
});

test('03:15 Shanghai schedule reconciles the previous date across calendar boundaries', () => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  if (process.platform === 'win32' && !existsSync(bash)) return;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  // Git for Windows lacks IANA zone data; Shanghai is UTC+8 at these dates.
  const zone = process.platform === 'win32' ? 'CST-8' : 'Asia/Shanghai';
  for (const [utc, expectedDay] of [
    ['2026-11-12T19:15:00Z', '2026-11-12'],
    ['2026-12-31T19:15:00Z', '2026-12-31'],
    ['2024-02-29T19:15:00Z', '2024-02-29']
  ]) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc))
      .map(({ type, value }) => [type, value]));
    assert.equal(`${parts.hour}:${parts.minute}`, '03:15', utc);
    const local = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:00`;
    const result = spawnSync(bash, ['-c', `TZ=${zone} date -d '${local} yesterday' +%F`],
      { encoding: 'utf8' });
    assert.equal(result.status, 0, `${utc}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), expectedDay, utc);
  }
});
