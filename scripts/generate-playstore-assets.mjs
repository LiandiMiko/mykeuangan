import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = 'playstore-assets';
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function encodePng(canvas) {
  const { width, height, buf: rgba } = canvas;
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

function blendPixel(canvas, x, y, rgba) {
  const { width: w, height: h, buf } = canvas;
  const [r, g, b, a = 255] = rgba;
  if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
  const i = (y * w + x) * 4;
  const srcA = a / 255;
  const invA = 1 - srcA;
  buf[i] = Math.round(r * srcA + buf[i] * invA);
  buf[i + 1] = Math.round(g * srcA + buf[i + 1] * invA);
  buf[i + 2] = Math.round(b * srcA + buf[i + 2] * invA);
  buf[i + 3] = 255;
}

function createGradientCanvas(width, height, c0, c1, diagMix) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = diagMix * (x / Math.max(1, width - 1)) + (1 - diagMix) * (y / Math.max(1, height - 1));
      const i = (y * width + x) * 4;
      buf[i] = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      buf[i + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      buf[i + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      buf[i + 3] = 255;
    }
  }
  return { width, height, buf };
}

function fillRoundedRect(canvas, rect, rgba) {
  const { width: w, height: h } = canvas;
  const { x: rx, y: ry, rw, rh, rad } = rect;
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(w, Math.ceil(rx + rw));
  const y1 = Math.min(h, Math.ceil(ry + rh));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, rx + rad), rx + rw - rad);
      const cy = Math.min(Math.max(y, ry + rad), ry + rh - rad);
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) blendPixel(canvas, x, y, rgba);
    }
  }
}

function fillCircle(canvas, circle, rgba, softEdge) {
  const { width: w, height: h } = canvas;
  const { cx, cy, rad } = circle;
  const [r, g, b, a = 255] = rgba;
  const x0 = Math.max(0, Math.floor(cx - rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const x1 = Math.min(w, Math.ceil(cx + rad));
  const y1 = Math.min(h, Math.ceil(cy + rad));
  const r2 = rad * rad;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r2) continue;
      const alpha = softEdge ? Math.round(a * Math.pow(1 - d2 / r2, 1.5)) : a;
      blendPixel(canvas, x, y, [r, g, b, alpha]);
    }
  }
}

function drawWalletEmblem(canvas, cx, cy, size) {
  const bx = cx - size * 0.5;
  const by = cy - size * 0.42;
  fillRoundedRect(canvas, { x: bx + size * 0.14, y: by - size * 0.14, rw: size * 0.68, rh: size * 0.34, rad: size * 0.08 }, [224, 231, 255, 210]);
  fillRoundedRect(canvas, { x: bx, y: by, rw: size, rh: size * 0.84, rad: size * 0.18 }, [255, 255, 255, 255]);
  fillRoundedRect(canvas, { x: cx + size * 0.08, y: cy - size * 0.13, rw: size * 0.44, rh: size * 0.26, rad: size * 0.11 }, [15, 23, 42, 255]);
  fillCircle(canvas, { cx: cx + size * 0.23, cy, rad: size * 0.075 }, [16, 185, 129, 255], false);
}

function buildPlayIcon512() {
  const canvas = createGradientCanvas(512, 512, [79, 70, 229], [49, 46, 129], 0.2);
  fillCircle(canvas, { cx: 160, cy: 120, rad: 220 }, [129, 140, 248, 70], true);
  drawWalletEmblem(canvas, 256, 272, 260);
  return encodePng(canvas);
}

function buildFeatureGraphic1024() {
  const canvas = createGradientCanvas(1024, 500, [15, 23, 42], [55, 48, 163], 0.65);
  fillCircle(canvas, { cx: 240, cy: 220, rad: 260 }, [79, 70, 229, 95], true);
  fillCircle(canvas, { cx: 830, cy: 140, rad: 240 }, [16, 185, 129, 55], true);

  fillRoundedRect(canvas, { x: 118, y: 110, rw: 280, rh: 280, rad: 56 }, [79, 70, 229, 245]);
  fillRoundedRect(canvas, { x: 124, y: 116, rw: 268, rh: 268, rad: 52 }, [67, 56, 202, 240]);
  drawWalletEmblem(canvas, 258, 260, 160);

  fillRoundedRect(canvas, { x: 456, y: 110, rw: 450, rh: 280, rad: 32 }, [15, 23, 42, 210]);
  const bars = [
    [504, 244, 52, 108, [71, 85, 105, 255]],
    [580, 212, 52, 140, [14, 165, 233, 255]],
    [656, 226, 52, 126, [99, 102, 241, 255]],
    [732, 178, 52, 174, [139, 92, 246, 255]],
    [808, 144, 52, 208, [16, 185, 129, 255]]
  ];
  bars.forEach(([x, y, rw, rh, col]) => fillRoundedRect(canvas, { x, y, rw, rh, rad: 14 }, col));
  fillCircle(canvas, { cx: 834, cy: 144, rad: 14 }, [110, 231, 183, 255], false);
  return encodePng(canvas);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'icon-512.png'), buildPlayIcon512());
  fs.writeFileSync(path.join(OUT_DIR, 'feature-graphic-1024x500.png'), buildFeatureGraphic1024());
  process.stdout.write(`✅ Play Store assets generated in ${OUT_DIR}/ (icon-512.png, feature-graphic-1024x500.png)\n`);
}

main();
