import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Gauge,
  LoaderCircle,
  Maximize2,
  Pin,
  PinOff,
  Repeat,
  RotateCcw,
  Timer,
  Trophy,
} from 'lucide-react';
import type { BenchmarkRun, MetricStats } from '../types';
import { copyText, e2eMsOf, formatDuration, formatTokens, formatTps, generationMsOf } from '../format';
import AnimatedNumber from './AnimatedNumber';

export interface Award {
  key: 'total' | 'ttft' | 'tps';
  label: string;
}

interface ResultCardProps {
  run: BenchmarkRun;
  rank: number | null;
  awards: Award[];
  highlighted?: boolean;
  pinned?: boolean;
  onTogglePin?: (key: string) => void;
  onSpotlight?: (key: string) => void;
  onRetry?: (keys?: string[]) => void;
  retryDisabled?: boolean;
}

const statusLabels: Record<BenchmarkRun['status'], string> = {
  queued: 'Dalam antrean',
  running: 'Menghubungi',
  streaming: 'Streaming',
  done: 'Selesai',
  error: 'Gagal',
};

function statValue(kind: 'duration' | 'tps', value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return kind === 'tps' ? formatTps(value) : formatDuration(value);
}

function DistributionBar({
  label,
  kind,
  stats,
}: {
  label: string;
  kind: 'duration' | 'tps';
  stats: MetricStats;
}) {
  const { min, max, median, count } = stats;
  if (min == null || max == null || median == null || count < 2) return null;
  const span = max - min;
  const position = span > 0 ? Math.max(0, Math.min(100, ((median - min) / span) * 100)) : 50;
  return (
    <div className="dist-row" title={`Rentang min–maks dari ${count} pengulangan; titik = median`}>
      <span className="dist-label">{label}</span>
      <span className="dist-track">
        <span className="dist-range" />
        <span className="dist-dot" style={{ left: `${position}%` }} />
      </span>
      <span className="dist-values">
        <em>{statValue(kind, min)}</em>
        <strong>{statValue(kind, median)}</strong>
        <em>{statValue(kind, max)}</em>
      </span>
    </div>
  );
}

export default function ResultCard({
  run,
  rank,
  awards,
  highlighted = false,
  pinned = false,
  onTogglePin,
  onSpotlight,
  onRetry,
  retryDisabled = false,
}: ResultCardProps) {
  const [copied, setCopied] = useState(false);
  const statsRef = useRef<HTMLDetailsElement>(null);
  const result = run.result;
  const isLive = run.status === 'running' || run.status === 'streaming';
  const aborted = run.status === 'error' && run.error?.code === 'aborted';
  const hasAward = awards.length > 0;
  const e2eMs = e2eMsOf(result) ?? run.elapsedMs;
  const generationMs = generationMsOf(result);
  const ttftMs = result?.ttftMs ?? run.ttftMs;
  const answerText = run.content || run.reasoning;
  const e2eStats = run.stats ? run.stats.e2eMs ?? run.stats.totalMs : null;
  const showStats = Boolean(run.stats) && (run.samples.length > 1 || (e2eStats?.count ?? 0) > 1);

  // Statistik langsung terlihat saat pengulangan > 1, tetapi tetap bisa ditutup pengguna.
  useEffect(() => {
    if (showStats && statsRef.current) statsRef.current.open = true;
  }, [showStats]);

  const statRows: Array<{
    label: string;
    kind: 'duration' | 'tps';
    stats: MetricStats;
  }> = [];
  if (run.stats) {
    statRows.push({ label: 'E2E', kind: 'duration', stats: run.stats.e2eMs ?? run.stats.totalMs });
    if (run.stats.generationMs) {
      statRows.push({ label: 'Generasi', kind: 'duration', stats: run.stats.generationMs });
    }
    statRows.push({ label: 'TTFT', kind: 'duration', stats: run.stats.ttftMs });
    statRows.push({ label: 'TPS', kind: 'tps', stats: run.stats.tps });
  }

  async function handleCopy() {
    if (!answerText) return;
    const success = await copyText(answerText);
    if (success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    }
  }

  return (
    <article
      className={`result-card ${hasAward ? 'is-winner' : ''} ${aborted ? 'is-stopped' : ''} ${highlighted ? 'is-highlighted' : ''} status-${run.status}`}
    >
      <div className="result-card-top">
        <span className={`card-rank ${rank === 1 ? 'rank-first' : ''}`}>
          {rank ? `#${rank}` : '—'}
        </span>
        <div className="result-name">
          <div className="result-name-line">
            <h3 title={run.model}>{run.model}</h3>
            {awards.map((award) => (
              <span className={`award-chip award-${award.key}`} key={award.key}>
                {award.key === 'total' && <Clock3 size={11} />}
                {award.key === 'ttft' && <Timer size={11} />}
                {award.key === 'tps' && <Gauge size={11} />}
                {award.label}
              </span>
            ))}
          </div>
          <div className="result-provider-line">
            <span className="provider-chip" title={run.providerHost || run.providerLabel}>
              {run.providerHost || run.providerLabel}
            </span>
            {run.retries > 0 && (
              <span className="retry-chip" title="Permintaan diulang otomatis karena rate limit atau gangguan sementara.">
                <RotateCcw size={11} />
                {run.retries}× retry
              </span>
            )}
            {isLive && run.sampleTotal > 1 && (
              <span className="sample-chip">
                <Repeat size={11} />
                sampel {run.repetition || 1}/{run.sampleTotal}
              </span>
            )}
          </div>
        </div>
        <span className={`run-status ${aborted ? 'status-aborted' : `status-${run.status}`}`}>
          {isLive && <LoaderCircle size={12} className="spin" />}
          {run.status === 'done' && <CheckCircle2 size={12} />}
          {run.status === 'error' && <AlertTriangle size={12} />}
          {aborted ? 'Dihentikan' : statusLabels[run.status]}
        </span>
      </div>

      <div className="result-metrics">
        <div className="result-metric">
          <span title="Latency E2E: dari prompt dikirim hingga seluruh jawaban selesai">E2E</span>
          <strong className={awards.some((award) => award.key === 'total') ? 'win-text' : ''}>
            <AnimatedNumber
              value={e2eMs}
              format={(value) => formatDuration(value)}
            />
          </strong>
          {generationMs != null && (
            <small title="Durasi generasi setelah token pertama (E2E − TTFT)">
              generasi {formatDuration(generationMs)}
            </small>
          )}
        </div>
        <div className="result-metric">
          <span>TTFT</span>
          <strong className={awards.some((award) => award.key === 'ttft') ? 'win-text' : ''}>
            <AnimatedNumber value={ttftMs} format={(value) => formatDuration(value)} />
          </strong>
        </div>
        <div className="result-metric">
          <span>TPS</span>
          <strong className={awards.some((award) => award.key === 'tps') ? 'win-text' : ''}>
            <AnimatedNumber
              value={result?.tps ?? null}
              format={(value) => `${!result?.tpsReliable ? '≈' : ''}${formatTps(value)}`}
            />
          </strong>
        </div>
        <div className="result-metric">
          <span>Token</span>
          <strong>
            <AnimatedNumber
              value={result?.completionTokens ?? null}
              format={(value) => formatTokens(value, result?.tokensEstimated)}
            />
          </strong>
        </div>
      </div>

      {showStats && (
        <details className="stats-block" ref={statsRef}>
          <summary>
            <Repeat size={14} />
            Statistik {e2eStats?.count ?? run.samples.length} pengulangan
            <span>median ditampilkan di atas</span>
          </summary>
          <div className="stats-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Metrik</th>
                  <th>Min</th>
                  <th>Median</th>
                  <th>Rata-rata</th>
                  <th>Maks</th>
                  <th>Stdev</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{statValue(row.kind, row.stats.min)}</td>
                    <td>{statValue(row.kind, row.stats.median)}</td>
                    <td>{statValue(row.kind, row.stats.mean)}</td>
                    <td>{statValue(row.kind, row.stats.max)}</td>
                    <td>{statValue(row.kind, row.stats.stdev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dist-block">
            <span className="dist-title">Sebaran pengulangan · titik = median</span>
            {statRows.map((row) => (
              <DistributionBar
                key={row.label}
                label={row.label}
                kind={row.kind}
                stats={row.stats}
              />
            ))}
          </div>
        </details>
      )}

      {run.error && (
        <div className="result-error">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {run.error.code === 'aborted' ? 'Pengujian dihentikan' : 'Model tidak dapat diuji'}
            </strong>
            <p>{run.error.message}</p>
            {run.error.status > 0 && (
              <span className="error-code">HTTP {run.error.status}</span>
            )}
            {run.error.details && (
              <details className="error-details">
                <summary>Detail dari provider</summary>
                <pre>{run.error.details}</pre>
              </details>
            )}
            {onRetry && (
              <button
                type="button"
                className="button secondary small-button retry-error-button"
                onClick={() => onRetry([run.key])}
                disabled={retryDisabled}
              >
                <RotateCcw size={13} />
                Ulangi model ini
              </button>
            )}
          </div>
        </div>
      )}

      {run.content || run.reasoning ? (
        <div className={`answer-wrap ${run.error ? 'has-error' : ''}`}>
          {run.error && (
            <span className="partial-note">
              Jawaban parsial — stream berhenti sebelum selesai.
            </span>
          )}
          {run.reasoning && (
            <details
              className="reasoning-block"
              open={!run.content && (run.status === 'streaming' || run.status === 'error')}
            >
              <summary>
                <Brain size={14} />
                Proses berpikir
                <span>{run.reasoning.length.toLocaleString('id-ID')} karakter</span>
              </summary>
              <div className="reasoning-text">{run.reasoning}</div>
            </details>
          )}

          {run.content && (
            <div className={`answer markdown ${isLive ? 'is-streaming' : ''}`}>
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
              {isLive && <span className="stream-caret" aria-hidden="true" />}
            </div>
          )}
        </div>
      ) : (
        !run.error && (
          <div className="answer-wrap">
            {run.status === 'done' ? (
              <div className="answer-empty">Model selesai tanpa mengirim konten teks.</div>
            ) : (
              <div className="answer-empty thinking">
                <span className="thinking-dots">
                  <span />
                  <span />
                  <span />
                </span>
                {run.status === 'queued' ? 'Menunggu giliran…' : 'Menunggu token pertama…'}
              </div>
            )}
          </div>
        )
      )}

      <div className="result-card-footer">
        <span className="footer-id" title={`${run.providerHost} · ${run.model}`}>
          {run.model}
        </span>
        {onTogglePin && run.status === 'done' && (
          <button
            type="button"
            className={`text-button pin-button ${pinned ? 'is-pinned' : ''}`}
            onClick={() => onTogglePin(run.key)}
            title={pinned ? 'Lepas dari perbandingan' : 'Pin untuk membandingkan'}
          >
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
            {pinned ? 'Lepas pin' : 'Pin'}
          </button>
        )}
        {onSpotlight && (run.status === 'done' || run.status === 'error') && (
          <button
            type="button"
            className="text-button"
            onClick={() => onSpotlight(run.key)}
            title="Buka jawaban dan statistik dalam tampilan fokus"
          >
            <Maximize2 size={13} />
            Fokus
          </button>
        )}
        {(run.status === 'done' || run.status === 'error') && answerText && (
          <button type="button" className="text-button" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Tersalin' : 'Salin jawaban'}
          </button>
        )}
        {run.status === 'done' && result && (
          <span className="tps-note" title="TPS dihitung dari token output dibagi durasi setelah token pertama.">
            <Trophy size={12} />
            {result.tpsReliable ? 'TPS terukur' : 'TPS perkiraan'}
          </span>
        )}
      </div>
    </article>
  );
}
