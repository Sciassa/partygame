/**
 * Genera le icone PWA (PNG) senza dipendenze: rasterizza una ruota neon in RGBA con
 * supersampling 4x4 e la codifica in PNG con zlib di Node.
 *   pnpm icons
 * Output in public/icons/ + public/favicon.svg
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public/icons');
mkdirSync(OUT, { recursive: true });

const BG = [11, 4, 32];
const SEGMENTS = [[0, 229, 255], [255, 43, 214], [255, 212, 0]];
const N = 12;
const TAU = Math.PI * 2;

/** Colore (rgba 0..1) del punto (x,y) in coordinate normalizzate [-1,1], y verso l'alto. */
function shade(x, y, { rounded, scale }) {
  // sfondo: quadrato arrotondato (icone "any") oppure pieno (maskable / apple)
  if (rounded) {
    const r = 0.36;
    const qx = Math.max(Math.abs(x) - (1 - r), 0);
    const qy = Math.max(Math.abs(y) - (1 - r), 0);
    if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  }
  let color = [...BG, 1];
  // alone magenta
  const d0 = Math.hypot(x, y);
  const glow = Math.max(0, 1 - d0 / (1.05 * scale)) ** 2 * 0.55;
  color = mix(color, [255, 43, 214, 1], glow);

  const px = x / scale;
  const py = (y + 0.08 * scale) / scale; // ruota leggermente in basso, puntatore sopra
  const d = Math.hypot(px, py);
  const R = 0.78;

  if (d <= R) {
    const a = (Math.atan2(-px, py) + TAU) % TAU; // angolo da +Y antiorario (come nel gioco)
    const i = Math.floor(a / (TAU / N));
    const local = (a % (TAU / N)) / (TAU / N);
    const base = SEGMENTS[i % 3];
    const k = 0.45 + 0.55 * (d / R);
    color = [base[0] * k, base[1] * k, base[2] * k, 1];
    // separatori
    const edge = Math.min(local, 1 - local) * (TAU / N) * d;
    if (edge < 0.012 && d > 0.17) color = [255, 246, 214, 1];
    // hub
    if (d < 0.17) color = d < 0.11 ? [255, 43, 214, 1] : [255, 211, 107, 1];
  } else if (d <= R + 0.09) {
    // cornice viola con lampadine
    color = [138, 43, 226, 1];
    const a = (Math.atan2(py, px) + TAU) % TAU;
    const bulb = a / (TAU / 24);
    const db = Math.abs(bulb - Math.round(bulb)) * (TAU / 24) * (R + 0.045);
    const dr = Math.abs(d - (R + 0.045));
    if (Math.hypot(db, dr) < 0.028) color = [255, 255, 255, 1];
  } else if (Math.abs(d - (R + 0.15)) < 0.018) {
    color = [0, 240, 255, 1]; // anello neon
  }

  // puntatore (triangolo rosso in alto)
  const ty = (py - (R + 0.02)) / 0.24; // 0 = punta, 1 = base
  if (ty >= 0 && ty <= 1 && Math.abs(px) <= ty * 0.13) color = [255, 51, 102, 1];
  return color;
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function render(size, opts) {
  const SS = 4;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const ny = 1 - ((y + (sy + 0.5) / SS) / size) * 2;
          const [r, g, b, a] = shade(nx, ny, opts);
          acc[0] += r * a;
          acc[1] += g * a;
          acc[2] += b * a;
          acc[3] += a;
        }
      }
      const o = (y * size + x) * 4;
      const alpha = acc[3] / (SS * SS);
      data[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
      data[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
      data[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, data);
}

// ---- PNG encoder minimale
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, { rounded: true, scale: 0.92 }],
  ['icon-512.png', 512, { rounded: true, scale: 0.92 }],
  // maskable: il contenuto deve stare nel cerchio "safe zone" (80% centrale)
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.72 }],
  // iOS applica la sua maschera: sfondo pieno, niente trasparenza
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.86 }],
];
for (const [file, size, opts] of icons) {
  writeFileSync(resolve(OUT, file), render(size, opts));
  console.log('✓', file);
}

writeFileSync(
  resolve(OUT, '../favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
  <rect x="-50" y="-50" width="100" height="100" rx="22" fill="#0b0420"/>
  <g transform="translate(0 4)">
    ${Array.from({ length: N }, (_, i) => {
      const a0 = -Math.PI / 2 - (i * TAU) / N;
      const a1 = a0 - TAU / N;
      const p = (a) => `${(Math.cos(a) * 36).toFixed(2)} ${(Math.sin(a) * 36).toFixed(2)}`;
      const c = ['#00e5ff', '#ff2bd6', '#ffd400'][i % 3];
      return `<path d="M0 0 L${p(a0)} A36 36 0 0 0 ${p(a1)} Z" fill="${c}"/>`;
    }).join('\n    ')}
    <circle r="38" fill="none" stroke="#8a2be2" stroke-width="5"/>
    <circle r="7" fill="#ffd36b"/>
  </g>
  <path d="M-7 -46 L7 -46 L0 -28 Z" fill="#ff3366"/>
</svg>
`,
);
console.log('✓ favicon.svg');
