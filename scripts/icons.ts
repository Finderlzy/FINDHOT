// Generates the site icons (site/brand/logo.svg, icon.png, icon-192.png, apple-icon.png, favicon.ico)
// from the 晨昏线 mark: a globe split into day and night by a curved terminator, tilted 23.4° like
// the Earth's axis, on a dark tile. Below 48px the axis is dropped and the strokes thickened, so the
// mark still reads in a browser tab. The same drawing, without the tile, is Mark in site/brand/Logo.tsx.
//
// Usage: node scripts/icons.ts
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = "site/brand";
const TILE = "#121826";
const DAY = "#F4B844";
const NIGHT = "#3A4D80";
const EDGE = "#ECE4D2";

/** The globe on a 512 tile: radius, stroke width, whether the axis shows, and the tile's corner radius. */
function svg({ r, stroke, axis, corner = 116 }: { r: number; stroke: number; axis: boolean; corner?: number }): string {
  const rx = (r * 14) / 40;
  const globe = [
    `<circle r="${r}" fill="${DAY}"/>`,
    `<path d="M0,${-r} A${r},${r} 0 0 1 0,${r} A${rx},${r} 0 0 1 0,${-r} Z" fill="${NIGHT}"/>`,
    `<circle r="${r}" fill="none" stroke="${EDGE}" stroke-width="${stroke}"/>`,
    axis
      ? `<path d="M0,${-(r + 4)} L0,${-r * 1.325} M0,${r + 4} L0,${r * 1.325}" stroke="${EDGE}" stroke-width="${stroke}" stroke-linecap="round" fill="none"/>`
      : "",
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${corner}" fill="${TILE}"/><g transform="translate(256 256) rotate(23.4)">${globe}</g></svg>`;
}

const full = svg({ r: 150, stroke: 10, axis: true });
const small = svg({ r: 190, stroke: 32, axis: false });
/** Square: iOS rounds the corners itself. */
const apple = svg({ r: 150, stroke: 10, axis: true, corner: 0 });

const png = (src: string, size: number) => sharp(Buffer.from(src)).resize(size, size).png().toBuffer();

/** A Windows icon holding PNG entries. */
function ico(entries: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size % 256, at);
    head.writeUInt8(size % 256, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

writeFileSync(`${OUT}/logo.svg`, full);
writeFileSync(`${OUT}/icon.png`, await png(full, 512));
writeFileSync(`${OUT}/icon-192.png`, await png(full, 192));
writeFileSync(`${OUT}/apple-icon.png`, await png(apple, 180));
writeFileSync(
  `${OUT}/favicon.ico`,
  ico([
    { size: 16, data: await png(small, 16) },
    { size: 32, data: await png(small, 32) },
    { size: 48, data: await png(full, 48) },
  ]),
);
