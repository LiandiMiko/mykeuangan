import fs from 'node:fs';
import zlib from 'node:zlib';

function createPNG(size) {
  const width = size, height = size;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 4;
      // Blue background #2563eb
      row[idx] = 0x25;
      row[idx + 1] = 0x63;
      row[idx + 2] = 0xeb;
      row[idx + 3] = 0xff;
      // Draw centered wallet white rectangle
      const pad = Math.floor(size * 0.22);
      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        row[idx] = 0xff;
        row[idx + 1] = 0xff;
        row[idx + 2] = 0xff;
      }
      // Draw clasp
      const claspLeft = Math.floor(size * 0.55), claspRight = size - pad;
      const claspTop = Math.floor(size * 0.44), claspBottom = Math.floor(size * 0.58);
      if (x >= claspLeft && x <= claspRight && y >= claspTop && y <= claspBottom) {
        row[idx] = 0x0f;
        row[idx + 1] = 0x17;
        row[idx + 2] = 0x2a;
      }
    }
    rows.push(row);
  }
  const rawData = Buffer.concat(rows);
  const compressed = zlib.deflateSync(rawData);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const combined = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    let c = ~0;
    for (let i = 0; i < combined.length; i++) {
      c ^= combined[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    crc.writeUInt32BE((~c) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

fs.mkdirSync('web/icons', { recursive: true });
fs.writeFileSync('web/icons/icon-192.png', createPNG(192));
fs.writeFileSync('web/icons/icon-512.png', createPNG(512));
fs.writeFileSync('web/icons/icon-maskable.png', createPNG(512));
console.log('Icons generated successfully');
