// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { expect, it } from 'vitest';

const asset = (name: string) => join(dirname(fileURLToPath(import.meta.url)), '../public', name);

it('ships a valid ICO with the advertised browser tab sizes', async () => {
  const ico = await readFile(asset('rowing-tab.ico'));
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(3);

  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    expect(ico[entry]).toBe(size);
    expect(ico[entry + 1]).toBe(size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const image = await sharp(ico.subarray(offset, offset + length)).metadata();
    expect(image).toMatchObject({ format: 'png', width: size, height: size });
  }
});

it('keeps the maskable artwork inside the safe circle on an opaque tile', async () => {
  const { data, info } = await sharp(asset('rowing-maskable-512.png'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: 512, height: 512, channels: 4 });

  const background = data.readUInt32BE(0);
  const center = info.width / 2;
  const safeRadius = info.width * 0.4;
  let hasTransparentPixel = false;
  let hasArtworkOutsideSafeCircle = false;
  let hasArtwork = false;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const color = data.readUInt32BE(4 * (y * info.width + x));
      hasTransparentPixel ||= (color & 0xff) !== 0xff;
      if (color !== background) {
        hasArtwork = true;
        hasArtworkOutsideSafeCircle ||= Math.hypot(x + 0.5 - center, y + 0.5 - center) > safeRadius;
      }
    }
  }
  expect(hasTransparentPixel).toBe(false);
  expect(hasArtwork).toBe(true);
  expect(hasArtworkOutsideSafeCircle).toBe(false);
});
