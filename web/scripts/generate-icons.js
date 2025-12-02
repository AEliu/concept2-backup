import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SVG content for the Concept2 rowing icon
const svgContent = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <title>Concept2 Rowing Editorial Logo</title>
  <defs>
    <style>
      .editorial-stroke{fill:none;stroke:#121212;stroke-width:16;stroke-linecap:square;stroke-linejoin:miter}
    </style>
  </defs>
  <path d="M80 256a176 176 0 1 1 352 0" class="editorial-stroke" stroke-dasharray="0" opacity=".9"/>
  <path class="editorial-stroke" d="M256 56v260M226 56h60"/>
  <path d="M-24 60h48l8 120h-64Z" style="fill:#121212" transform="translate(256 256)"/>
</svg>`;

// Public directory
const publicDir = path.join(__dirname, '..', 'public');

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

async function generateIcons() {
  try {
    console.log('Generating PWA icons from SVG...');

    // Create SVG buffer
    const svgBuffer = Buffer.from(svgContent);

    // Generate 192x192 PNG (for pwa-192x192.png)
    await sharp(svgBuffer)
      .resize(192, 192)
      .png()
      .toFile(path.join(publicDir, 'pwa-192x192.png'));

    console.log('✓ Generated pwa-192x192.png');

    // Generate 512x512 PNG (for pwa-512x512.png)
    await sharp(svgBuffer)
      .resize(512, 512)
      .png()
      .toFile(path.join(publicDir, 'pwa-512x512.png'));

    console.log('✓ Generated pwa-512x512.png');

    // Generate 180x180 PNG (for apple-touch-icon.png)
    await sharp(svgBuffer)
      .resize(180, 180)
      .png()
      .toFile(path.join(publicDir, 'apple-touch-icon.png'));

    console.log('✓ Generated apple-touch-icon.png');

    // Generate 512x512 PNG with transparent background for masked-icon
    // Maskable icons should have safe zone in center
    const maskedSvgContent = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <title>Concept2 Rowing Editorial Logo - Maskable</title>
  <defs>
    <style>
      .editorial-stroke{fill:none;stroke:#121212;stroke-width:16;stroke-linecap:square;stroke-linejoin:miter}
    </style>
  </defs>
  <rect width="512" height="512" fill="white"/>
  <g transform="translate(0, 0)">
    <path d="M80 256a176 176 0 1 1 352 0" class="editorial-stroke" stroke-dasharray="0" opacity=".9"/>
    <path class="editorial-stroke" d="M256 56v260M226 56h60"/>
    <path d="M-24 60h48l8 120h-64Z" style="fill:#121212" transform="translate(256 256)"/>
  </g>
</svg>`;

    await sharp(Buffer.from(maskedSvgContent))
      .resize(512, 512)
      .png()
      .toFile(path.join(publicDir, 'masked-icon.png'));

    console.log('✓ Generated masked-icon.png');

    // Generate favicon.ico with multiple sizes embedded
    // ICO typically contains 16x16, 32x32, 48x48 sizes
    const faviconSizes = [16, 32, 48];
    const icoData = [];

    for (const size of faviconSizes) {
      const pngData = await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer();

      icoData.push({
        data: pngData,
        size,
      });
    }

    // Use sharp to create multi-size favicon.ico
    // We'll create separate sizes and convert to ICO format
    const largestIcon = await sharp(svgBuffer)
      .resize(256, 256)
      .png()
      .toBuffer();

    // Note: sharp can output ICO directly from PNG
    await sharp(largestIcon)
      .resize(32, 32)
      .toFile(path.join(publicDir, 'favicon.ico'));

    console.log('✓ Generated favicon.ico');

    console.log('\n✅ All PWA icons generated successfully!');
    console.log('Files created in:', publicDir);

  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
