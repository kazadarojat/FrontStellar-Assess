import { useEffect } from 'react';
import { GitCompare, Minus, PinOff, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { BenchmarkRun } from '../types';
import { e2eMsOf, formatDuration, formatTokens, formatTps } from '../format';

interface CompareDrawerProps {
  runs: BenchmarkRun[];
  baselineKey: string;
  onBaseline: (key: string) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}

interface MetricConfig {
  key: string;
  label: string;
  lowerIsBetter: boolean;
  value: (run: BenchmarkRun) => number | null;
  format: (value: number) => string;
}

const METRICS: MetricConfig[] = [
  {
    key: 'e2e',
    label: 'Latency E2E',
    lowerIsBetter: true,
    value: (run) => e2eMsOf(run.result),
    format: (value) => formatDuration(value),
  },
  {
    key: 'ttft',
    label: 'TTFT',
    lowerIsBetter: true,
    value: (run) => run.result?.ttftMs ?? null,
    format: (value) => formatDuration(value),
  },
  {
    key: 'tps',
    label: 'TPS',
    lowerIsBetter: false,
    value: (run) => run.result?.tps ?? null,
    format: (value) => formatTps(value),
  },
  {
    key: 'tokens',
    label: 'Token output',
    lowerIsBetter: false,
    value: (run) => run.result?.completionTokens ?? null,
    format: (value) => formatTokens(value),
  },
];

function deltaOf(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

export default function CompareDrawer({
  runs,
  baselineKey,
  onBaseline,
  onRemove,
  onClose,
}: CompareDrawerProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const baseline = runs.find((run) => run.key === baselineKey) ?? runs[0];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal compare-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Perbandingan model yang dipin"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow small">
              <GitCompare size={13} />
              Mode banding
            </span>
            <h3>Bandingkan {runs.length} model</h3>
            <span className="modal-sub">
              Delta dihitung terhadap baseline. Jawaban lengkap ditampilkan di bawah.
            </span>
          </div>
          <div className="modal-head-actions">
            <label className="baseline-picker">
              Baseline
              <select value={baseline?.key ?? ''} onChange={(event) => onBaseline(event.target.value)}>
                {runs.map((run) => (
                  <option value={run.key} key={run.key}>
                    {run.model}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Tutup mode banding"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Metrik</th>
                {runs.map((run) => (
                  <th key={run.key}>
                    <span className="compare-model" title={run.model}>
                      {run.model}
                    </span>
                    <span className="compare-provider">
                      {run.providerHost || run.providerLabel}
                    </span>
                    {run.key === baseline?.key && <em className="baseline-tag">baseline</em>}
                    <button
                      type="button"
                      className="compare-unpin"
                      onClick={() => onRemove(run.key)}
                      title={`Lepas pin ${run.model}`}
                    >
                      <PinOff size={11} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => {
                const baseValue = baseline ? metric.value(baseline) : null;
                return (
                  <tr key={metric.key}>
                    <td>{metric.label}</td>
                    {runs.map((run) => {
                      const value = metric.value(run);
                      const delta = run.key === baseline?.key ? 0 : deltaOf(value, baseValue);
                      const better =
                        delta != null &&
                        delta !== 0 &&
                        (metric.lowerIsBetter ? delta < 0 : delta > 0);
                      return (
                        <td key={run.key}>
                          <strong>{value == null ? '—' : metric.format(value)}</strong>
                          {run.key === baseline?.key ? (
                            <span className="delta-badge neutral">
                              <Minus size={10} /> acuan
                            </span>
                          ) : delta == null ? (
                            <span className="delta-badge neutral">—</span>
                          ) : (
                            <span
                              className={`delta-badge ${
                                delta === 0 ? 'neutral' : better ? 'better' : 'worse'
                              }`}
                            >
                              {delta === 0 ? (
                                <Minus size={10} />
                              ) : better ? (
                                <TrendingUp size={10} />
                              ) : (
                                <TrendingDown size={10} />
                              )}
                              {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                              {Math.abs(delta).toFixed(1)}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="compare-answers-head">
          <h4>Jawaban side-by-side</h4>
          <span>{baseline ? `Baseline: ${baseline.model}` : 'Pilih baseline'}</span>
        </div>
        <div
          className="compare-answers"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, runs.length)}, minmax(0, 1fr))` }}
        >
          {runs.map((run) => (
            <article className="compare-answer" key={run.key}>
              <header>
                <strong>{run.model}</strong>
                <span>{run.providerHost || run.providerLabel}</span>
              </header>
              <div className="compare-answer-text">
                {run.content || run.reasoning || 'Tidak ada jawaban.'}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
