import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Clock3,
  Copy,
  Gauge,
  RotateCcw,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';
import type { BenchmarkRun, MetricStats } from '../types';
import { copyText, e2eMsOf, formatDuration, formatTokens, formatTps, generationMsOf } from '../format';

interface SpotlightModalProps {
  run: BenchmarkRun;
  onClose: () => void;
  onRetry?: (key: string) => void;
  retryDisabled?: boolean;
}

interface StatRow {
  label: string;
  kind: 'duration' | 'tps';
  stats: MetricStats;
}

function statText(kind: 'duration' | 'tps', value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return kind === 'tps' ? formatTps(value) : formatDuration(value);
}

export default function SpotlightModal({
  run,
  onClose,
  onRetry,
  retryDisabled = false,
}: SpotlightModalProps) {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const answer = run.content || run.reasoning;
  const result = run.result;

  async function handleCopy() {
    if (!answer) return;
    const success = await copyText(answer);
    if (success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    }
  }

  const statRows: StatRow[] = [];
  if (run.stats) {
    statRows.push({ label: 'E2E', kind: 'duration', stats: run.stats.e2eMs ?? run.stats.totalMs });
    if (run.stats.generationMs) {
      statRows.push({ label: 'Generasi', kind: 'duration', stats: run.stats.generationMs });
    }
    statRows.push({ label: 'TTFT', kind: 'duration', stats: run.stats.ttftMs });
    statRows.push({ label: 'TPS', kind: 'tps', stats: run.stats.tps });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal spotlight-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Tampilan fokus ${run.model}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow small">
              <Sparkles size={13} />
              Tampilan fokus
            </span>
            <h3>{run.model}</h3>
            <span className="modal-sub">
              {run.providerLabel}
              {run.providerHost && run.providerHost !== run.providerLabel
                ? ` · ${run.providerHost}`
                : ''}
            </span>
          </div>
          <div className="modal-head-actions">
            {answer && (
              <button type="button" className="button secondary small-button" onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Tersalin' : 'Salin'}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Tutup tampilan fokus"
              ref={closeRef}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="spotlight-metrics">
          <div>
            <span>
              <Clock3 size={12} /> Latency E2E
            </span>
            <strong>{formatDuration(e2eMsOf(result))}</strong>
            <small>generasi {formatDuration(generationMsOf(result))}</small>
          </div>
          <div>
            <span>
              <Timer size={12} /> TTFT
            </span>
            <strong>{formatDuration(result?.ttftMs)}</strong>
          </div>
          <div>
            <span>
              <Gauge size={12} /> TPS
            </span>
            <strong>
              {result?.tps != null
                ? `${!result.tpsReliable ? '≈' : ''}${formatTps(result.tps)}`
                : '—'}
            </strong>
          </div>
          <div>
            <span>Token</span>
            <strong>
              {result ? formatTokens(result.completionTokens, result.tokensEstimated) : '—'}
            </strong>
          </div>
        </div>

        {statRows.length > 1 && (
          <div className="spotlight-stats">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Metrik</th>
                  <th>Min</th>
                  <th>Median</th>
                  <th>Rata-rata</th>
                  <th>Maks</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{statText(row.kind, row.stats.min)}</td>
                    <td>{statText(row.kind, row.stats.median)}</td>
                    <td>{statText(row.kind, row.stats.mean)}</td>
                    <td>{statText(row.kind, row.stats.max)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="spotlight-answer">
          {run.error && (
            <div className="result-error">
              <strong>{run.error.code === 'aborted' ? 'Dihentikan' : 'Model gagal'}</strong>
              <p>{run.error.message}</p>
              {onRetry && (
                <button
                  type="button"
                  className="button secondary small-button"
                  onClick={() => onRetry(run.key)}
                  disabled={retryDisabled}
                >
                  <RotateCcw size={13} />
                  Ulangi model ini
                </button>
              )}
            </div>
          )}
          {run.reasoning && (
            <details className="reasoning-block" open={!run.content}>
              <summary>Proses berpikir · {run.reasoning.length.toLocaleString('id-ID')} karakter</summary>
              <div className="reasoning-text">{run.reasoning}</div>
            </details>
          )}
          {run.content ? (
            <div className="answer markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {run.content}
              </ReactMarkdown>
            </div>
          ) : (
            !run.error && <p className="spotlight-empty">Belum ada jawaban untuk model ini.</p>
          )}
        </div>
      </div>
    </div>
  );
}
