const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'public');

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

async function generateFavicon() {
  console.log('Generating favicon...');

  const svgBuffer = Buffer.from(`
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="30" fill="#1a1a1a"/>
      <text x="32" y="38" font-family="monospace" font-size="16" font-weight="700" fill="#f3f3f1" text-anchor="middle">RS</text>
    </svg>
  `);

  try {
    await sharp(svgBuffer)
      .png()
      .toFile(path.join(ICONS_DIR, 'favicon.ico'));

    console.log('✓ favicon.ico generated');
  } catch (error) {
    console.error('Error generating favicon:', error);
  }
}

async function generateAppleTouchIcon() {
  console.log('Generating Apple touch icon...');

  const svgBuffer = Buffer.from(`
    <svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
      <rect width="180" height="180" fill="#f3f3f1"/>
      <circle cx="90" cy="90" r="70" fill="#1a1a1a"/>
      <g transform="translate(90, 90)">
        <rect x="-4" y="-30" width="8" height="40" fill="#f3f3f1" rx="4"/>
        <path d="M -20 20 Q -20 28 -12 28 L 12 28 Q 20 28 20 20 L 20 12 Q 20 4 12 4 L -12 4 Q -20 4 -20 12 Z" fill="#f3f3f1"/>
      </g>
      <text x="90" y="140" font-family="Space Mono, monospace" font-size="18" font-weight="700" fill="#1a1a1a" text-anchor="middle" letter-spacing="2">ROWING STATS</text>
    </svg>
  `);

  try {
    await sharp(svgBuffer)
      .png()
      .toFile(path.join(ICONS_DIR, 'apple-touch-icon.png'));

    console.log('✓ apple-touch-icon.png generated');
  } catch (error) {
    console.error('Error generating apple touch icon:', error);
  }
}

async function generatePWAIcons() {
  console.log('Generating PWA icons...');

  // Generate 192x192 icon
  const svg192 = Buffer.from(`
    <svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
      <circle cx="96" cy="96" r="90" fill="#1a1a1a"/>
      <g transform="translate(96, 96)">
        <rect x="-6" y="-36" width="12" height="52" fill="#f3f3f1" rx="4"/>
        <path d="M -30 24 Q -30 36 -18 36 L 18 36 Q 30 36 30 24 L 30 12 Q 30 0 18 0 L -18 0 Q -30 0 -30 12 Z" fill="#f3f3f1"/>
        <ellipse cx="0" cy="54" rx="15" ry="3" fill="#f3f3f1" opacity="0.3"/>
      </g>
      <text x="96" y="150" font-family="Space Mono, monospace" font-size="20" font-weight="700" fill="#f3f3f1" text-anchor="middle" letter-spacing="4">RS</text>
    </svg>
  `);

  try {
    await sharp(svg192)
      .png()
      .toFile(path.join(ICONS_DIR, 'pwa-192x192.png'));

    console.log('✓ pwa-192x192.png generated');
  } catch (error) {
    console.error('Error generating 192x192 icon:', error);
  }

  // Generate 512x512 icon
  const svg512 = Buffer.from(`
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <circle cx="256" cy="256" r="240" fill="#1a1a1a"/>
      <g transform="translate(256, 256)">
        <rect x="-16" y="-96" width="32" height="140" fill="#f3f3f1" rx="8"/>
        <path d="M -80 64 Q -80 96 -48 96 L 48 96 Q 80 96 80 64 L 80 32 Q 80 0 48 0 L -48 0 Q -80 0 -80 32 Z" fill="#f3f3f1"/>
        <ellipse cx="0" cy="144" rx="40" ry="8" fill="#f3f3f1" opacity="0.3"/>
        <ellipse cx="0" cy="160" rx="30" ry="6" fill="#f3f3f1" opacity="0.2"/>
      </g>
      <text x="256" y="420" font-family="Space Mono, monospace" font-size="48" font-weight="700" fill="#f3f3f1" text-anchor="middle" letter-spacing="4">RS</text>
    </svg>
  `);

  try {
    await sharp(svg512)
      .png()
      .toFile(path.join(ICONS_DIR, 'pwa-512x512.png'));

    console.log('✓ pwa-512x512.png generated');
  } catch (error) {
    console.error('Error generating 512x512 icon:', error);
  }
}

async function generateMaskableIcon() {
  console.log('Generating maskable icon...');

  const svgMaskable = Buffer.from(`
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#1a1a1a"/>
      <g transform="translate(256, 256)">
        <rect x="-16" y="-96" width="32" height="140" fill="#f3f3f1" rx="8"/>
        <path d="M -80 64 Q -80 96 -48 96 L 48 96 Q 80 96 80 64 L 80 32 Q 80 0 48 0 L -48 0 Q -80 0 -80 32 Z" fill="#f3f3f1"/>
      </g>
      <text x="256" y="420" font-family="Space Mono, monospace" font-size="48" font-weight="700" fill="#f3f3f1" text-anchor="middle" letter-spacing="4">RS</text>
    </svg>
  `);

  try {
    await sharp(svgMaskable)
      .png()
      .toFile(path.join(ICONS_DIR, 'masked-icon.png'));

    console.log('✓ masked-icon.png generated');
  } catch (error) {
    console.error('Error generating maskable icon:', error);
  }
}

async function main() {
  console.log('Generating PWA icons...\n');

  await generateFavicon();
  await generateAppleTouchIcon();
  await generatePWAIcons();
  await generateMaskableIcon();

  console.log('\n✓ All icons generated successfully!');
}

main().catch(console.error);
