import type { BenchmarkRun } from './types';
import { e2eMsOf, formatDuration, formatTokens, formatTps } from './format';

const WIDTH = 1200;
const HEIGHT = 860;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth - 12) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 2))}…`;
    }
  }
  return lines;
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 72) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();
}

function finish(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }, 'image/png');
}

/** Kartu ringkasan benchmark yang bisa dibagikan sebagai PNG. */
export function downloadSummaryPng(
  filename: string,
  runs: BenchmarkRun[],
  prompt: string,
  accent = '#c9ff5c',
): void {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const done = runs
    .filter((run) => run.status === 'done' && run.result)
    .sort((a, b) => (e2eMsOf(a.result) ?? Infinity) - (e2eMsOf(b.result) ?? Infinity));

  // Latar & grid.
  ctx.fillStyle = '#070a0d';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawGrid(ctx);

  const glow = ctx.createRadialGradient(WIDTH * 0.82, 0, 40, WIDTH * 0.82, 0, 620);
  glow.addColorStop(0, `${accent}22`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, 620);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, WIDTH, 6);

  // Header.
  ctx.fillStyle = accent;
  ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('FRONTSTELLAR ASSESS', 64, 74);
  ctx.fillStyle = '#f2f6f1';
  ctx.font = '700 50px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Ringkasan Benchmark', 64, 138);

  ctx.fillStyle = '#8998a5';
  ctx.font = '400 17px "Segoe UI", system-ui, sans-serif';
  const promptLines = wrapText(ctx, prompt || 'Tanpa prompt', 900, 2);
  promptLines.forEach((line, index) => {
    ctx.fillText(line, 64, 176 + index * 24);
  });

  ctx.textAlign = 'right';
  ctx.fillStyle = '#60707d';
  ctx.font = '400 15px "Consolas", monospace';
  ctx.fillText(new Date().toLocaleString('id-ID'), WIDTH - 64, 74);
  ctx.fillText(`${done.length} model selesai`, WIDTH - 64, 98);
  ctx.textAlign = 'left';

  // Podium.
  const podium = done.slice(0, 3);
  const podiumOrder = [1, 0, 2].filter((index) => podium[index]);
  const cardWidth = 344;
  const gap = 22;
  const podiumY = 250;
  podiumOrder.forEach((index, column) => {
    const run = podium[index];
    if (!run) return;
    const x = 64 + column * (cardWidth + gap);
    roundedRect(ctx, x, podiumY, cardWidth, 156, 18);
    ctx.fillStyle = index === 0 ? 'rgba(201,255,92,0.08)' : 'rgba(255,255,255,0.035)';
    ctx.fill();
    ctx.strokeStyle = index === 0 ? `${accent}66` : 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = index === 0 ? accent : '#8998a5';
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(index === 0 ? 'JUARA 1' : index === 1 ? 'JUARA 2' : 'JUARA 3', x + 22, podiumY + 34);

    ctx.fillStyle = '#f2f6f1';
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    const nameLines = wrapText(ctx, run.model, cardWidth - 44, 1);
    ctx.fillText(nameLines[0] ?? run.model, x + 22, podiumY + 68);

    ctx.fillStyle = '#8998a5';
    ctx.font = '400 14px "Consolas", monospace';
    ctx.fillText(run.providerHost || run.providerLabel, x + 22, podiumY + 92);

    ctx.fillStyle = accent;
    ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(formatDuration(e2eMsOf(run.result)), x + 22, podiumY + 132);
    ctx.fillStyle = '#60707d';
    ctx.font = '400 13px "Consolas", monospace';
    ctx.fillText(
      `TTFT ${formatDuration(run.result?.ttftMs)}  ·  TPS ${formatTps(run.result?.tps)}`,
      x + 22,
      podiumY + 150,
    );
  });

  // Tabel ringkas.
  const tableY = 448;
  ctx.fillStyle = '#60707d';
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('MODEL', 64, tableY);
  ctx.fillText('PROVIDER', 520, tableY);
  ctx.fillText('E2E', 780, tableY);
  ctx.fillText('TTFT', 900, tableY);
  ctx.fillText('TPS', 1010, tableY);
  ctx.fillText('TOKEN', 1090, tableY);

  const rows = done.slice(0, 8);
  const maxE2e = Math.max(1, ...rows.map((run) => e2eMsOf(run.result) ?? 1));
  rows.forEach((run, index) => {
    const y = tableY + 28 + index * 46;
    const e2e = e2eMsOf(run.result) ?? 0;

    roundedRect(ctx, 56, y - 26, WIDTH - 112, 38, 8);
    ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.012)';
    ctx.fill();

    const barWidth = Math.max(4, (e2e / maxE2e) * 120);
    roundedRect(ctx, 762, y - 17, barWidth, 6, 3);
    ctx.fillStyle = index === 0 ? accent : 'rgba(98,217,255,0.55)';
    ctx.fill();

    ctx.fillStyle = index === 0 ? accent : '#e8efea';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(wrapText(ctx, run.model, 420, 1)[0] ?? run.model, 64, y);

    ctx.fillStyle = '#8998a5';
    ctx.font = '400 13px "Consolas", monospace';
    ctx.fillText(wrapText(ctx, run.providerHost || run.providerLabel, 230, 1)[0] ?? '', 520, y);
    ctx.fillStyle = '#f2f6f1';
    ctx.fillText(formatDuration(e2e), 780, y);
    ctx.fillText(formatDuration(run.result?.ttftMs), 900, y);
    ctx.fillText(formatTps(run.result?.tps), 1010, y);
    ctx.fillText(
      formatTokens(run.result?.completionTokens, run.result?.tokensEstimated),
      1090,
      y,
    );
  });

  // Footer.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(64, HEIGHT - 78);
  ctx.lineTo(WIDTH - 64, HEIGHT - 78);
  ctx.stroke();
  ctx.fillStyle = '#60707d';
  ctx.font = '400 13px "Consolas", monospace';
  ctx.fillText('Latency E2E = prompt terkirim hingga jawaban selesai · tanpa waktu antrean', 64, HEIGHT - 44);
  ctx.textAlign = 'right';
  ctx.fillText('frontstellar-assess', WIDTH - 64, HEIGHT - 44);
  ctx.textAlign = 'left';

  finish(canvas, filename);
}
