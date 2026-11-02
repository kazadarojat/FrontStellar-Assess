import { useEffect } from 'react';
import { GitCompare, Minus, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { BenchmarkRun } from '../types';
import type { HistoryEntry } from '../history';
import { e2eMsOf, formatDateTime, formatDuration, formatTps, truncate } from '../format';

interface HistoryDiffProps {
  first: HistoryEntry;
  second: HistoryEntry;
  onClose: () => void;
}

interface DiffRow {
  key: string;
  model: string;
  provider: string;
  a: BenchmarkRun | null;
  b: BenchmarkRun | null;
}

function keyOf(run: BenchmarkRun): string {
  // providerId dibuat ulang tiap sesi, jadi gunakan host/label agar diff tetap
  // mencocokkan model yang sama antar riwayat dari sesi berbeda.
  return `${run.providerHost || run.providerLabel || run.providerId}::${run.model}`;
}

function runMap(entry: HistoryEntry): Map<string, BenchmarkRun> {
  return new Map(entry.runs.map((run) => [keyOf(run), run]));
}

function percent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function Delta({
  value,
  lowerIsBetter,
}: {
  value: number | null;
  lowerIsBetter: boolean;
}) {
  if (value == null) return <span className="delta-badge neutral">—</span>;
  if (Math.abs(value) < 0.05) {
    return (
      <span className="delta-badge neutral">
        <Minus size={10} /> 0%
      </span>
    );
  }
  const better = lowerIsBetter ? value < 0 : value > 0;
  return (
    <span className={`delta-badge ${better ? 'better' : 'worse'}`}>
      {better ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {value > 0 ? '+' : '−'}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export default function HistoryDiff({ first, second, onClose }: HistoryDiffProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const firstMap = runMap(first);
  const secondMap = runMap(second);
  const keys = [...new Set([...firstMap.keys(), ...secondMap.keys()])];
  const rows: DiffRow[] = keys.map((key) => {
    const a = firstMap.get(key) ?? null;
    const b = secondMap.get(key) ?? null;
    const sample = a ?? b;
    return {
      key,
      model: sample?.model ?? key,
      provider: sample?.providerHost || sample?.providerLabel || '—',
      a,
      b,
    };
  });

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal history-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Perbandingan dua riwayat"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow small">
              <GitCompare size={13} />
              Diff riwayat
            </span>
            <h3>Bandingkan dua benchmark</h3>
            <span className="modal-sub">
              Delta B terhadap A. Hijau berarti lebih baik untuk metrik tersebut.
            </span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Tutup diff riwayat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="diff-heads">
          <article>
            <strong>A</strong>
            <span>{formatDateTime(first.createdAt)}</span>
            <p title={first.prompt}>{truncate(first.prompt.replace(/\s+/g, ' '), 120)}</p>
            <small>{first.runs.length} model · {first.repetitions}× ulangan</small>
          </article>
          <article>
            <strong>B</strong>
            <span>{formatDateTime(second.createdAt)}</span>
            <p title={second.prompt}>{truncate(second.prompt.replace(/\s+/g, ' '), 120)}</p>
            <small>{second.runs.length} model · {second.repetitions}× ulangan</small>
          </article>
        </div>

        {first.prompt !== second.prompt && (
          <p className="diff-warning">
            Prompt berbeda. Perbedaan metrik bisa dipengaruhi isi prompt, bukan hanya performa model.
          </p>
        )}

        <div className="compare-table-wrap diff-table-wrap">
          <table className="compare-table diff-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>A E2E</th>
                <th>B E2E</th>
                <th>Δ E2E</th>
                <th>A TPS</th>
                <th>B TPS</th>
                <th>Δ TPS</th>
                <th>A TTFT</th>
                <th>B TTFT</th>
                <th>Δ TTFT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const aE2e = e2eMsOf(row.a?.result);
                const bE2e = e2eMsOf(row.b?.result);
                const aTps = row.a?.result?.tps ?? null;
                const bTps = row.b?.result?.tps ?? null;
                const aTtft = row.a?.result?.ttftMs ?? null;
                const bTtft = row.b?.result?.ttftMs ?? null;
                return (
                  <tr key={row.key}>
                    <td>
                      <span className="diff-model" title={row.model}>
                        {row.model}
                      </span>
                      <small>{row.provider}</small>
                    </td>
                    <td>{formatDuration(aE2e)}</td>
                    <td>{formatDuration(bE2e)}</td>
                    <td>
                      <Delta value={percent(bE2e, aE2e)} lowerIsBetter />
                    </td>
                    <td>{formatTps(aTps)}</td>
                    <td>{formatTps(bTps)}</td>
                    <td>
                      <Delta value={percent(bTps, aTps)} lowerIsBetter={false} />
                    </td>
                    <td>{formatDuration(aTtft)}</td>
                    <td>{formatDuration(bTtft)}</td>
                    <td>
                      <Delta value={percent(bTtft, aTtft)} lowerIsBetter />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
