const idNumber = new Intl.NumberFormat('id-ID');

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  if (seconds < 100) return `${seconds.toFixed(1)} s`;
  return `${seconds.toFixed(0)} s`;
}

export function formatTps(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps)) return '—';
  if (tps >= 1_000) return idNumber.format(Math.round(tps));
  if (tps >= 100) return tps.toFixed(1);
  return tps.toFixed(2);
}

export function formatTokens(tokens: number | null | undefined, estimated = false): string {
  if (tokens == null || !Number.isFinite(tokens)) return '—';
  return `${estimated ? '≈' : ''}${idNumber.format(Math.round(tokens))}`;
}

interface LatencyLike {
  e2eMs?: number;
  totalMs?: number;
  generationMs?: number;
  ttftMs?: number | null;
}

/** Latency E2E dengan fallback ke `totalMs` untuk data riwayat versi lama. */
export function e2eMsOf(result: LatencyLike | null | undefined): number | null {
  if (!result) return null;
  const value = result.e2eMs ?? result.totalMs;
  return value != null && Number.isFinite(value) ? value : null;
}

/** Durasi generasi (E2E − TTFT) dengan fallback untuk data lama. */
export function generationMsOf(result: LatencyLike | null | undefined): number | null {
  if (!result) return null;
  if (result.generationMs != null && Number.isFinite(result.generationMs)) {
    return result.generationMs;
  }
  const e2e = e2eMsOf(result);
  if (e2e == null) return null;
  return Math.max(0, e2e - (result.ttftMs ?? 0));
}

export function formatContext(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace('.0', '')}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens} context`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function truncate(value: string, length = 48): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null>>) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          let value = String(cell ?? '');
          if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace(/[:T]/g, '-');
}


export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const success = document.execCommand('copy');
      document.body.removeChild(area);
      return success;
    } catch {
      return false;
    }
  }
}
