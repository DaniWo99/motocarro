/**
 * GRÁFICOS LIGEROS EN CANVAS NATIVO (MODO OSCURO PLANO, CERO GRADIENTES)
 * Nítidos en pantallas Retina (iPhone) y sin dependencias externas.
 */

import { formatShortK } from './utils.js';

const COLORS = {
  grid: '#27272a',
  text: '#a1a1aa',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  empty: '#1f1f24'
};

function setupCanvas(canvas, heightPx = 200) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const parentWidth = canvas.parentElement ? canvas.parentElement.clientWidth : 320;
  const width = Math.max(260, parentWidth);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(heightPx * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${heightPx}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, heightPx);
  return { ctx, width, height: heightPx };
}

/**
 * Gráfico de barras simple (ingresos diarios o ingresos mensuales).
 */
export function drawBarChart(canvas, labels, values, barColor = COLORS.green) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas, 190);
  const padLeft = 46;
  const padRight = 10;
  const padTop = 14;
  const padBottom = 26;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(...values, 50000);
  const steps = 4;

  // Líneas de guía horizontales
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = COLORS.text;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= steps; i++) {
    const val = (maxVal / steps) * i;
    const y = padTop + chartH - (chartH * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padLeft, Math.round(y) + 0.5);
    ctx.lineTo(width - padRight, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(formatShortK(val), padLeft - 6, y);
  }

  const count = labels.length || 1;
  const slotW = chartW / count;
  const barW = Math.max(3, Math.min(28, slotW * 0.65));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = count > 16 ? Math.ceil(count / 8) : 1;

  for (let i = 0; i < count; i++) {
    const val = values[i] || 0;
    const h = maxVal > 0 ? (val / maxVal) * chartH : 0;
    const x = padLeft + i * slotW + (slotW - barW) / 2;
    const y = padTop + chartH - h;

    ctx.fillStyle = val > 0 ? barColor : COLORS.empty;
    const drawH = val > 0 ? Math.max(2, h) : 2;
    ctx.fillRect(x, padTop + chartH - drawH, barW, drawH);

    if (i % labelEvery === 0 || i === count - 1) {
      ctx.fillStyle = COLORS.text;
      ctx.fillText(labels[i], padLeft + i * slotW + slotW / 2, padTop + chartH + 8);
    }
  }
}

/**
 * Gráfico de barras agrupadas: Ingresos (verde) vs. Pagos a Rappi (rojo).
 */
export function drawComparisonChart(canvas, labels, incomes, loanPayments) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas, 200);
  const padLeft = 48;
  const padRight = 10;
  const padTop = 14;
  const padBottom = 28;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(...incomes, ...loanPayments, 350000);
  const steps = 4;

  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= steps; i++) {
    const val = (maxVal / steps) * i;
    const y = padTop + chartH - (chartH * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padLeft, Math.round(y) + 0.5);
    ctx.lineTo(width - padRight, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(formatShortK(val), padLeft - 6, y);
  }

  const count = labels.length || 1;
  const groupW = chartW / count;
  const barW = Math.max(6, Math.min(20, groupW * 0.32));
  const gap = 3;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < count; i++) {
    const centerX = padLeft + i * groupW + groupW / 2;
    const incVal = incomes[i] || 0;
    const loanVal = loanPayments[i] || 0;

    const incH = maxVal > 0 ? (incVal / maxVal) * chartH : 0;
    const loanH = maxVal > 0 ? (loanVal / maxVal) * chartH : 0;

    ctx.fillStyle = incVal > 0 ? COLORS.green : COLORS.empty;
    const dIncH = incVal > 0 ? Math.max(2, incH) : 2;
    ctx.fillRect(centerX - barW - gap / 2, padTop + chartH - dIncH, barW, dIncH);

    ctx.fillStyle = loanVal > 0 ? COLORS.red : COLORS.empty;
    const dLoanH = loanVal > 0 ? Math.max(2, loanH) : 2;
    ctx.fillRect(centerX + gap / 2, padTop + chartH - dLoanH, barW, dLoanH);

    ctx.fillStyle = COLORS.text;
    ctx.fillText(labels[i], centerX, padTop + chartH + 8);
  }
}
