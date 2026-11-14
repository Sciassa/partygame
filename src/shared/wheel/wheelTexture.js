import { TAU } from './kinematics.js';
import { segmentInfo } from './segments.js';

export const WHEEL_FONT = '"Oswald", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';
const CREAM = '#f4ead5';
const BRASS = '#d4a24c';

/** Schiarisce (amount>0) o scurisce (amount<0) un colore #rrggbb. */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const ch = (v) => Math.round(v + (target - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/**
 * Disegna la faccia della ruota su un canvas 2D (diventa la texture della CircleGeometry).
 * Mappatura: centro canvas = centro ruota, alto canvas = +Y. Lo spicchio i occupa gli angoli locali
 * [i*s, (i+1)*s) da +Y in senso antiorario (vedi kinematics.js), che nel canvas (y verso il basso)
 * corrispondono agli angoli arc() da -π/2 - i*s a -π/2 - (i+1)*s, percorsi in senso antiorario.
 */
export function drawWheelFace(canvas, segments, size) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const r = size / 2;
  const n = segments.length;
  const s = TAU / n;

  ctx.clearRect(0, 0, size, size);

  // Spicchi: colore pieno con vignettatura verso il centro (profondità, niente effetto "plastica")
  segments.forEach((segment, i) => {
    const { color } = segmentInfo(segment);
    const a0 = -Math.PI / 2 - i * s;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a0 - s, true);
    ctx.closePath();
    const grad = ctx.createRadialGradient(c, c, r * 0.1, c, c, r);
    grad.addColorStop(0, shade(color, -0.7));
    grad.addColorStop(0.5, shade(color, -0.3));
    grad.addColorStop(0.9, color);
    grad.addColorStop(1, shade(color, 0.12));
    ctx.fillStyle = grad;
    ctx.fill();
  });

  // Filetto ottone interno, vicino al bordo
  ctx.beginPath();
  ctx.arc(c, c, r * 0.955, 0, TAU);
  ctx.lineWidth = size * 0.004;
  ctx.strokeStyle = 'rgba(212, 162, 76, 0.55)';
  ctx.stroke();

  // Separatori in ottone
  ctx.save();
  ctx.translate(c, c);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = size * 0.005;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 - i * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.17, Math.sin(a) * r * 0.17);
    ctx.lineTo(Math.cos(a) * r * 0.995, Math.sin(a) * r * 0.995);
    ctx.stroke();
  }
  ctx.restore();

  // Etichette (lungo il raggio, dal centro verso il bordo) e icone (in piedi verso l'esterno)
  const chordAtLabel = 2 * r * 0.55 * Math.sin(s / 2);
  segments.forEach((segment, i) => {
    const info = segmentInfo(segment);
    const center = -Math.PI / 2 - (i + 0.5) * s;

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(center);
    const maxWidth = r * 0.44;
    let fontSize = Math.min(chordAtLabel * 0.6, r * 0.105);
    ctx.font = `700 ${fontSize}px ${WHEEL_FONT}`;
    const w = ctx.measureText(info.label).width;
    if (w > maxWidth) {
      fontSize *= maxWidth / w;
      ctx.font = `700 ${fontSize}px ${WHEEL_FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = fontSize * 0.25;
    ctx.shadowOffsetY = fontSize * 0.05;
    ctx.fillStyle = CREAM;
    ctx.fillText(info.label, r * 0.53, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(center + Math.PI / 2);
    ctx.translate(0, -r * 0.84);
    const iconSize = Math.min(2 * r * 0.84 * Math.sin(s / 2) * 0.55, r * 0.11);
    drawIcon(ctx, info.icon, iconSize);

    // Adesivi applicati (placeholder grafico: un bollino per adesivo)
    segment.stickers?.forEach((sticker, k) => {
      ctx.beginPath();
      ctx.arc((k - (segment.stickers.length - 1) / 2) * iconSize * 0.6, r * 0.15, iconSize * 0.2, 0, TAU);
      ctx.fillStyle = sticker.color ?? CREAM;
      ctx.fill();
    });
    ctx.restore();
  });

  // Mozzo: anello scuro sotto il tappo 3D
  ctx.beginPath();
  ctx.arc(c, c, r * 0.17, 0, TAU);
  ctx.fillStyle = '#120d0a';
  ctx.fill();

  // Leggera lucidatura satinata dall'alto
  const sheen = ctx.createLinearGradient(0, 0, 0, size);
  sheen.addColorStop(0, 'rgba(255,240,210,0.08)');
  sheen.addColorStop(0.45, 'rgba(255,240,210,0.0)');
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fillStyle = sheen;
  ctx.fill();
}

/** Icone vettoriali (crema) centrate in (0,0), alte circa `size`. */
function drawIcon(ctx, icon, size) {
  ctx.save();
  ctx.fillStyle = CREAM;
  ctx.strokeStyle = CREAM;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = size * 0.15;
  const u = size / 2;
  switch (icon) {
    case 'bolt': {
      ctx.beginPath();
      ctx.moveTo(0.15 * u, -u);
      ctx.lineTo(-0.55 * u, 0.12 * u);
      ctx.lineTo(-0.02 * u, 0.12 * u);
      ctx.lineTo(-0.2 * u, u);
      ctx.lineTo(0.55 * u, -0.18 * u);
      ctx.lineTo(0.03 * u, -0.18 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'coin': {
      ctx.lineWidth = u * 0.16;
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.86, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = u * 0.07;
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.6, 0, TAU);
      ctx.stroke();
      // stellina a 4 punte al centro
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 - Math.PI / 2;
        const rr = k % 2 === 0 ? u * 0.42 : u * 0.13;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      ctx.font = `700 ${size * 1.25}px ${WHEEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, size * 0.05);
    }
  }
  ctx.restore();
}

/** Texture radiale morbida (alone ambra dietro la ruota, pozze di luce). */
export function drawGlow(canvas, size, inner, outer = 'rgba(0,0,0,0)') {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/** Muro di mattoni scuri, appena percettibile: dà profondità al fondo "pub". */
export function drawBrickWall(canvas, size) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const bh = size / rows;
  const bw = bh * 2.1;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < size + bw; x += bw) {
      const l = 14 + rand() * 7;
      ctx.fillStyle = `hsl(${220 + rand() * 12}, 18%, ${l * 0.55}%)`;
      ctx.fillRect(x + offset + bh * 0.06, row * bh + bh * 0.06, bw - bh * 0.12, bh - bh * 0.12);
    }
  }
}
