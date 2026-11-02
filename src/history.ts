import type { BenchmarkRun } from './types';

export interface HistoryEntry {
  id: string;
  createdAt: string;
  prompt: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  concurrency: number;
  repetitions: number;
  wallTotalMs: number | null;
  retries: number;
  runs: BenchmarkRun[];
}

const STORAGE_KEY = 'frontstellar.history';
const LEGACY_KEY = 'modelbench.history';
const MAX_ENTRIES = 15;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.prompt === 'string' &&
    Array.isArray(entry.runs)
  );
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function persist(entries: HistoryEntry[]): HistoryEntry[] {
  let next = entries.slice(0, MAX_ENTRIES);
  while (next.length) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch {
      // Kuota localStorage penuh: buang entri paling lama lalu coba lagi.
      next = next.slice(0, -1);
    }
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
  return [];
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const current = loadHistory().filter((item) => item.id !== entry.id);
  return persist([entry, ...current]);
}

export function removeHistory(id: string): HistoryEntry[] {
  return persist(loadHistory().filter((item) => item.id !== id));
}

export function clearHistory(): HistoryEntry[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignore storage failures.
  }
  return [];
}

/** Ganti seluruh riwayat (dipakai untuk mengurungkan penghapusan). */
export function replaceHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return persist(entries);
}

export function historyProviderLabels(entry: HistoryEntry): string[] {
  const labels = new Set<string>();
  for (const run of entry.runs) {
    labels.add(run.providerHost || run.providerLabel);
  }
  return [...labels];
}

export function historyRetries(entry: HistoryEntry): number {
  return entry.runs.reduce((sum, run) => sum + (run.retries || 0), 0);
}
