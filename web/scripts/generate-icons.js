import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicFile = name => new URL(`../public/${name}`, import.meta.url);
const mark = (await readFile(new URL('../logo_icon.svg', import.meta.url), 'utf8')).trim();
const background = '#8d2d42';

function renderIcon(adaptive = false) {
  const tile = adaptive
    ? `<rect width="64" height="64" fill="${background}"/>`
    : `<rect x="1.5" y="1.5" width="61" height="61" rx="14" fill="${background}" stroke="#f5c6b7" stroke-width="3"/>`;
  // Keep the mark inside the Android maskable icon's central safe circle.
  const glyph = adaptive ? `<g transform="translate(4.8 4.8) scale(.85)">${mark}</g>` : mark;
  return Buffer.from(`<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <title>Rowing Dynamics</title>
  ${tile}
  ${glyph}
</svg>\n`);
}

const favicon = renderIcon();
const adaptiveIcon = renderIcon(true);

function png(icon, size) {
  return sharp(icon, { density: 576 }).resize(size, size).png();
}

async function writeIco() {
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(size => png(favicon, size).toBuffer()));
  // ICO directory followed by a PNG at each advertised size.
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((data, index) => {
    const entry = 6 + 16 * index;
    directory[entry] = sizes[index];
    directory[entry + 1] = sizes[index];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  await writeFile(publicFile('rowing-tab.ico'), Buffer.concat([directory, ...images]));
}

await Promise.all([
  writeFile(publicFile('rowing-icon.svg'), favicon),
  writeIco(),
  png(favicon, 192).toFile(fileURLToPath(publicFile('rowing-app-192.png'))),
  png(favicon, 512).toFile(fileURLToPath(publicFile('rowing-app-512.png'))),
  png(adaptiveIcon, 512).toFile(fileURLToPath(publicFile('rowing-maskable-512.png'))),
  png(adaptiveIcon, 180).toFile(fileURLToPath(publicFile('rowing-touch-180.png'))),
]);
