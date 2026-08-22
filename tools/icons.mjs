// Generates PWA icons from an inline SVG using sharp.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="${pad ? 0 : 110}" fill="#111418"/>
  <rect x="${96 + pad}" y="${96 + pad}" width="${320 - 2 * pad}" height="${320 - 2 * pad}" rx="${64 - pad / 4}" fill="#4f8cff"/>
  <path d="M ${176 + pad * 0.6} ${262} l ${52 - pad * 0.3} ${52 - pad * 0.3} l ${112 - pad * 0.6} ${-112 + pad * 0.6}"
        fill="none" stroke="#ffffff" stroke-width="${40 - pad / 6}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

mkdirSync('public/icons', { recursive: true });
const out = async (name, size, pad = 0) => {
  const buf = await sharp(Buffer.from(svg(pad))).resize(size, size).png().toBuffer();
  writeFileSync(`public/icons/${name}`, buf);
  console.log('wrote', name);
};
await out('icon-192.png', 192);
await out('icon-512.png', 512);
await out('apple-touch-icon.png', 180);
await out('icon-maskable-512.png', 512, 48);
