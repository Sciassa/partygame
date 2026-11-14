import { TAU, segmentLayout } from './kinematics.js';
import { segmentInfo } from './segments.js';

export const WHEEL_FONT = '"Oswald", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';
const GOLD = '#d9a94f';
const GOLD_LIGHT = '#f3d595';

/** Schiarisce (amount>0) o scurisce (amount<0) un colore #rrggbb. */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const ch = (v) => Math.round(v + (target - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/**
 * Faccia della ruota (texture della CircleGeometry), nello stile della reference:
 * spicchi blu notte opachi, separatori oro doppi, decori art déco a raggiera e scritte oro.
 *
 * Mappatura: centro canvas = centro ruota, alto canvas = +Y. Lo spicchio i occupa gli angoli locali
 * [i*s, (i+1)*s) da +Y in senso antiorario (vedi kinematics.js), cioè nel canvas (y verso il basso)
 * gli angoli arc() da -π/2 - i*s a -π/2 - (i+1)*s, percorsi in senso antiorario.
 */
export function drawWheelFace(canvas, segments, size) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const r = size / 2;
  const n = segments.length;
  const layout = segmentLayout(segments);
  // angoli canvas di inizio/fine di ogni spicchio (gli spicchi possono avere ampiezze diverse)
  const arcOf = (i) => ({ a0: -Math.PI / 2 - layout[i].start, a1: -Math.PI / 2 - layout[i].end, s: layout[i].end - layout[i].start });

  ctx.clearRect(0, 0, size, size);

  segments.forEach((segment, i) => {
    const { color } = segmentInfo(segment);
    const { a0, a1, s } = arcOf(i);

    // fondo: vinile scuro, appena più chiaro verso il bordo (alternato per dare ritmo)
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a1, true);
    ctx.closePath();
    const grad = ctx.createRadialGradient(c, c, r * 0.15, c, c, r);
    grad.addColorStop(0, shade(color, -0.45));
    grad.addColorStop(0.7, i % 2 ? shade(color, 0.03) : color);
    grad.addColorStop(1, shade(color, i % 2 ? 0.1 : 0.06));
    ctx.fillStyle = grad;
    ctx.fill();

    // decoro art déco: raggiera sottile dal mozzo verso il bordo + chevron
    ctx.save();
    ctx.translate(c, c);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a1, true);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = 'rgba(217, 169, 79, 0.32)';
    ctx.lineWidth = size * 0.0025;
    const mid = a0 - s / 2;
    const apex = [Math.cos(mid) * r * 0.24, Math.sin(mid) * r * 0.24];
    for (let k = -2; k <= 2; k++) {
      const a = mid + k * s * 0.17;
      ctx.beginPath();
      ctx.moveTo(apex[0], apex[1]);
      ctx.lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02);
      ctx.stroke();
    }
    for (const rr of [0.78, 0.83]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0 - s * 0.12) * r * rr, Math.sin(a0 - s * 0.12) * r * rr);
      ctx.lineTo(Math.cos(mid) * r * (rr + 0.05), Math.sin(mid) * r * (rr + 0.05));
      ctx.lineTo(Math.cos(a1 + s * 0.12) * r * rr, Math.sin(a1 + s * 0.12) * r * rr);
      ctx.stroke();
    }
    ctx.restore();
  });

  // Separatori oro doppi (scanalatura scura nel mezzo)
  ctx.save();
  ctx.translate(c, c);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = arcOf(i).a0;
    const from = [Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2];
    const to = [Math.cos(a) * r, Math.sin(a) * r];
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.stroke();
    ctx.strokeStyle = '#0d1018';
    ctx.lineWidth = size * 0.004;
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.stroke();
  }
  ctx.restore();

  // Bordo nel colore della birra del proprietario per gli spicchi con un adesivo
  segments.forEach((segment, i) => {
    if (!segment.sticker) return;
    const { a0, a1 } = arcOf(i);
    const inset = size * 0.012;
    ctx.save();
    ctx.translate(c, c);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0) * r * 0.22, Math.sin(a0) * r * 0.22);
    ctx.arc(0, 0, r - inset, a0, a1, true);
    ctx.lineTo(Math.cos(a1) * r * 0.22, Math.sin(a1) * r * 0.22);
    ctx.arc(0, 0, r * 0.22, a1, a0, false);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * (segment.sticker.level > 1 ? 0.016 : 0.011);
    ctx.strokeStyle = segment.sticker.ownerColor ?? GOLD;
    ctx.shadowColor = segment.sticker.ownerColor ?? GOLD;
    ctx.shadowBlur = size * 0.01;
    ctx.stroke();
    ctx.restore();
  });

  // Scritte (lungo il raggio) e icone (in piedi verso l'esterno), in oro
  segments.forEach((segment, i) => {
    const info = segmentInfo(segment);
    const { a0, s } = arcOf(i);
    const chordAtLabel = 2 * r * 0.56 * Math.sin(Math.min(s, Math.PI / 2) / 2);
    const center = a0 - s / 2;

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(center);
    const maxWidth = r * 0.42;
    let fontSize = Math.min(chordAtLabel * 0.5, r * 0.1);
    ctx.font = `600 ${fontSize}px ${WHEEL_FONT}`;
    const w = ctx.measureText(info.label).width;
    if (w > maxWidth) {
      fontSize *= maxWidth / w;
      ctx.font = `600 ${fontSize}px ${WHEEL_FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textGrad = ctx.createLinearGradient(0, -fontSize / 2, 0, fontSize / 2);
    textGrad.addColorStop(0, GOLD_LIGHT);
    textGrad.addColorStop(1, GOLD);
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = fontSize * 0.2;
    ctx.fillStyle = textGrad;
    ctx.fillText(info.label, r * 0.55, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(center + Math.PI / 2);
    ctx.translate(0, -r * 0.88);
    const iconSize = Math.min(2 * r * 0.88 * Math.sin(Math.min(s, Math.PI / 2) / 2) * 0.42, r * 0.085);
    drawIcon(ctx, info.icon, iconSize);
    ctx.restore();

    // Adesivo: bollino con icona, livello, lucchetto e montepremi
    const sticker = segment.sticker;
    if (sticker) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(center + Math.PI / 2);
      ctx.translate(0, -r * 0.31);
      const br = Math.min(r * 0.075, 2 * r * 0.31 * Math.sin(Math.min(s, Math.PI / 2) / 2) * 0.48);
      ctx.beginPath();
      ctx.arc(0, 0, br, 0, TAU);
      ctx.fillStyle = '#10141f';
      ctx.fill();
      ctx.lineWidth = br * 0.18;
      ctx.strokeStyle = sticker.ownerColor ?? GOLD;
      ctx.stroke();
      ctx.font = `${br * 1.05}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sticker.icon ?? '★', 0, br * 0.06);
      if (sticker.level > 1) {
        ctx.font = `700 ${br * 0.62}px ${WHEEL_FONT}`;
        ctx.fillStyle = GOLD_LIGHT;
        ctx.fillText('II', br * 0.95, -br * 0.85);
      }
      if (sticker.lockedTurns > 0) {
        ctx.font = `${br * 0.6}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.fillText('🔒', -br * 0.95, -br * 0.85);
      }
      if (segment.jackpot > 0) {
        ctx.font = `600 ${br * 0.6}px ${WHEEL_FONT}`;
        ctx.fillStyle = GOLD_LIGHT;
        ctx.fillText(`${segment.jackpot}`, 0, br * 1.6);
      }
      ctx.restore();
    }
  });

  // Anello oro sottile attorno al mozzo
  ctx.beginPath();
  ctx.arc(c, c, r * 0.2, 0, TAU);
  ctx.lineWidth = size * 0.008;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
}

/** Icone vettoriali oro, centrate in (0,0), alte circa `size`. */
function drawIcon(ctx, icon, size) {
  ctx.save();
  ctx.fillStyle = GOLD_LIGHT;
  ctx.strokeStyle = GOLD_LIGHT;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
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
    case 'keg': {
      // fusto di birra stilizzato
      ctx.lineWidth = u * 0.14;
      ctx.beginPath();
      ctx.ellipse(0, -u * 0.62, u * 0.62, u * 0.2, 0, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-u * 0.62, -u * 0.62);
      ctx.quadraticCurveTo(-u * 0.82, 0, -u * 0.62, u * 0.62);
      ctx.moveTo(u * 0.62, -u * 0.62);
      ctx.quadraticCurveTo(u * 0.82, 0, u * 0.62, u * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, u * 0.62, u * 0.62, u * 0.2, 0, 0, Math.PI);
      ctx.stroke();
      for (const y of [-0.2, 0.2]) {
        ctx.beginPath();
        ctx.moveTo(-u * 0.72, y * u);
        ctx.lineTo(u * 0.72, y * u);
        ctx.stroke();
      }
      break;
    }
    case 'coin': {
      ctx.lineWidth = u * 0.16;
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.86, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 - Math.PI / 2;
        const rr = k % 2 === 0 ? u * 0.5 : u * 0.15;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      ctx.font = `600 ${size * 1.3}px ${WHEEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, size * 0.05);
    }
  }
  ctx.restore();
}

/** Texture radiale morbida (aloni, ombre di contatto, bagliori). */
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

/**
 * Fondale "pub fuori fuoco" come nella reference: legno scuro, travi verticali sfocate,
 * lampade calde in bokeh e un filo di teal lontano. Disegnato una volta, costo zero a runtime.
 */
export function drawPubBokeh(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#07080c');
  base.addColorStop(0.55, '#120e0c');
  base.addColorStop(1, '#0a0909');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // travi/scaffali di legno, sfocati
  ctx.filter = `blur(${Math.round(width * 0.006)}px)`;
  for (let i = 0; i < 9; i++) {
    const x = rand() * width;
    const w = width * (0.015 + rand() * 0.035);
    ctx.fillStyle = `rgba(${40 + rand() * 25}, ${24 + rand() * 12}, ${14 + rand() * 8}, ${0.35 + rand() * 0.3})`;
    ctx.fillRect(x, 0, w, height);
  }
  for (let i = 0; i < 4; i++) {
    const y = height * (0.2 + rand() * 0.45);
    ctx.fillStyle = `rgba(48, 30, 18, ${0.25 + rand() * 0.2})`;
    ctx.fillRect(0, y, width, height * 0.012);
  }
  ctx.filter = 'none';

  // bokeh: lampade calde e riflessi
  const blob = (x, y, rad, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color.replace('A', alpha));
    g.addColorStop(0.55, color.replace('A', alpha * 0.45));
    g.addColorStop(1, color.replace('A', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
  };
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const x = rand() * width;
    const y = height * (0.15 + rand() * 0.6);
    blob(x, y, width * (0.008 + rand() * 0.03), 'rgba(255,170,80,A)', 0.12 + rand() * 0.35);
  }
  // due lampade "vere" più grandi, come nella reference (sinistra in basso, destra in alto)
  blob(width * 0.12, height * 0.62, width * 0.05, 'rgba(255,175,90,A)', 0.85);
  blob(width * 0.8, height * 0.26, width * 0.045, 'rgba(255,160,80,A)', 0.6);
  blob(width * 0.95, height * 0.45, width * 0.06, 'rgba(70,170,190,A)', 0.18);
  ctx.globalCompositeOperation = 'source-over';

  // vignettatura
  const v = ctx.createRadialGradient(width / 2, height * 0.45, height * 0.2, width / 2, height * 0.45, width * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, width, height);
}

/** Nuvola di fumo morbida per la foschia del locale. */
export function drawHaze(canvas, size) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const x = size * (0.2 + rand() * 0.6);
    const y = size * (0.3 + rand() * 0.4);
    const rad = size * (0.08 + rand() * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.09)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
}
