import { TAU } from './kinematics.js';
import { segmentInfo } from './segments.js';

const FONT = '"Arial Black", "Arial Rounded MT Bold", system-ui, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Schiarisce (amount>0) o scurisce (amount<0) un colore #rrggbb. */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const ch = (v) => Math.round(v + (target - v) * k);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
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

  // Spicchi
  segments.forEach((segment, i) => {
    const { color } = segmentInfo(segment);
    const a0 = -Math.PI / 2 - i * s;
    const a1 = a0 - s;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a1, true);
    ctx.closePath();
    const grad = ctx.createRadialGradient(c, c, r * 0.12, c, c, r);
    grad.addColorStop(0, shade(color, -0.75));
    grad.addColorStop(0.45, shade(color, -0.35));
    grad.addColorStop(0.92, color);
    grad.addColorStop(1, shade(color, 0.35));
    ctx.fillStyle = grad;
    ctx.fill();
  });

  // Separatori luminosi
  ctx.save();
  ctx.translate(c, c);
  ctx.strokeStyle = '#fff6d6';
  ctx.lineWidth = size * 0.006;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = size * 0.012;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 - i * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.restore();

  // Testi ed emoji
  const chordAtLabel = 2 * r * 0.52 * Math.sin(s / 2);
  segments.forEach((segment, i) => {
    const info = segmentInfo(segment);
    const center = -Math.PI / 2 - (i + 0.5) * s;

    // Etichetta lungo il raggio (si legge dal centro verso il bordo)
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(center);
    const maxWidth = r * 0.46;
    let fontSize = Math.min(chordAtLabel * 0.62, r * 0.11);
    ctx.font = `900 ${fontSize}px ${FONT}`;
    const w = ctx.measureText(info.label).width;
    if (w > maxWidth) {
      fontSize *= maxWidth / w;
      ctx.font = `900 ${fontSize}px ${FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.22;
    ctx.strokeStyle = 'rgba(20, 0, 40, 0.85)';
    ctx.strokeText(info.label, r * 0.5, 0);
    ctx.shadowColor = info.color;
    ctx.shadowBlur = fontSize * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(info.label, r * 0.5, 0);
    ctx.restore();

    // Emoji vicino al bordo, "in piedi" rispetto all'esterno
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(center + Math.PI / 2);
    const emojiSize = Math.min(2 * r * 0.84 * Math.sin(s / 2) * 0.62, r * 0.13);
    ctx.font = `${emojiSize}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.emoji, 0, -r * 0.84);

    // Adesivi applicati (placeholder grafico: un bollino per adesivo)
    segment.stickers?.forEach((sticker, k) => {
      ctx.beginPath();
      ctx.arc((k - (segment.stickers.length - 1) / 2) * emojiSize * 0.55, -r * 0.7, emojiSize * 0.22, 0, TAU);
      ctx.fillStyle = sticker.color ?? '#ffffff';
      ctx.fill();
    });
    ctx.restore();
  });

  // Riflesso lucido sulla metà superiore
  const gloss = ctx.createLinearGradient(0, 0, 0, size);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)');
  gloss.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fillStyle = gloss;
  ctx.fill();

  // Bordo interno scuro (separa la faccia dal bordo 3D)
  ctx.beginPath();
  ctx.arc(c, c, r * 0.995, 0, TAU);
  ctx.lineWidth = size * 0.01;
  ctx.strokeStyle = 'rgba(10,0,30,0.8)';
  ctx.stroke();
}

/** Texture radiale morbida per l'alone dietro la ruota (sprite additivo, costo ~zero). */
export function drawGlow(canvas, size, color) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.45, 'rgba(120, 40, 255, 0.35)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}
