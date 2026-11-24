import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ASSETS_DIR = 'assets';
const INDIGO = [0x4f, 0x46, 0xe5, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const SLATE_DARK = [0x0f, 0x17, 0x2a, 0xff];
const EMERALD = [0x10, 0xb9, 0x81, 0xff];
const TRANSPARENT = [0x00, 0x00, 0x00, 0x00];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  let crc = 0xffffffff;
  for (let i = 0; i < combined.length; i += 1) {
    crc = CRC_TABLE[(crc ^ combined[i]) & 0xff] ^ (crc >>> 8);
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeSolidRow(width, rgba) {
  const row = Buffer.alloc(1 + width * 4);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const idx = 1 + x * 4;
    row[idx] = rgba[0];
    row[idx + 1] = rgba[1];
    row[idx + 2] = rgba[2];
    row[idx + 3] = rgba[3];
  }
  return row;
}

function paintSpan(row, xStart, xEnd, rgba) {
  for (let x = Math.max(0, xStart); x < xEnd; x += 1) {
    const idx = 1 + x * 4;
    row[idx] = rgba[0];
    row[idx + 1] = rgba[1];
    row[idx + 2] = rgba[2];
    row[idx + 3] = rgba[3];
  }
}

function buildWalletArtworkRows(size, bgRgba, badgeRgba, emblemRatio) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  const bgRow = makeSolidRow(size, bgRgba);
  const box = Math.round(size * emblemRatio);
  const x0 = Math.floor((size - box) / 2);
  const y0 = Math.floor((size - box) / 2);
  const pad = Math.round(box * 0.22);
  const wx0 = x0 + pad;
  const wx1 = x0 + box - pad;
  const wy0 = y0 + pad;
  const wy1 = y0 + box - pad;
  const claspX0 = x0 + Math.round(box * 0.54);
  const claspY0 = y0 + Math.round(box * 0.43);
  const claspY1 = y0 + Math.round(box * 0.59);

  const badgeRow = Buffer.from(bgRow);
  if (badgeRgba) paintSpan(badgeRow, x0, x0 + box, badgeRgba);

  const walletRow = Buffer.from(badgeRow);
  paintSpan(walletRow, wx0, wx1, WHITE);

  const claspRow = Buffer.from(walletRow);
  paintSpan(claspRow, claspX0, wx1, EMERALD);

  for (let y = 0; y < size; y += 1) {
    let tpl = bgRow;
    if (y >= wy0 && y < wy1) tpl = (y >= claspY0 && y < claspY1) ? claspRow : walletRow;
    else if (badgeRgba && y >= y0 && y < y0 + box) tpl = badgeRow;
    tpl.copy(raw, y * stride);
  }
  return raw;
}

function encodePng(width, height, rawBytes) {
  const compressed = zlib.deflateSync(rawBytes, { level: 6 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

function writeAsset(filename, size, rawBytes) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSETS_DIR, filename), encodePng(size, size, rawBytes));
}

function main() {
  writeAsset('icon-only.png', 1024, buildWalletArtworkRows(1024, INDIGO, INDIGO, 0.86));
  writeAsset('icon-foreground.png', 1024, buildWalletArtworkRows(1024, TRANSPARENT, null, 0.62));
  writeAsset('icon-background.png', 1024, buildWalletArtworkRows(1024, INDIGO, null, 0));
  writeAsset('splash.png', 2732, buildWalletArtworkRows(2732, WHITE, INDIGO, 0.16));
  writeAsset('splash-dark.png', 2732, buildWalletArtworkRows(2732, SLATE_DARK, INDIGO, 0.16));
  process.stdout.write(`✅ Native icon & splash source assets generated in ${ASSETS_DIR}/\n`);
}

main();
