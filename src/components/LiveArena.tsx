import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Crown,
  Gauge,
  LoaderCircle,
  MousePointerClick,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import type { BenchmarkRun, Phase } from '../types';
import { e2eMsOf, formatDuration, formatTps } from '../format';
import AnimatedNumber from './AnimatedNumber';

interface LiveArenaProps {
  runs: BenchmarkRun[];
  phase: Phase;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onSpotlight?: (key: string) => void;
}

const LANE_COLORS = ['#c9ff5c', '#62d9ff', '#ffb45f', '#ff7c7c', '#b58cff', '#6fe3a0'];

interface TickerItem {
  id: string;
  text: string;
  tone: 'e2e' | 'ttft' | 'tps';
}

function progressFor(run: BenchmarkRun, maxChars: number): number {
  if (run.status === 'done' || run.status === 'error') return 100;
  if (!run.content) return 3;
  return Math.max(3, Math.min(97, (run.content.length / Math.max(1, maxChars)) * 100));
}

function laneStatus(run: BenchmarkRun): string {
  if (run.status === 'queued') return 'Antre';
  if (run.status === 'running') return 'Menghubungi';
  if (run.status === 'error') return 'Gagal';
  const tokens = run.result?.completionTokens ?? Math.round(run.content.length / 4);
  if (run.status === 'streaming') return `${tokens.toLocaleString('id-ID')} tok`;
  return `${tokens.toLocaleString('id-ID')} tok`;
}

export default function LiveArena({
  runs,
  phase,
  selectedKey,
  onSelect,
  onSpotlight,
}: LiveArenaProps) {
  const recordsRef = useRef({ e2e: Infinity, ttft: Infinity, tps: 0 });
  const previousPhaseRef = useRef<Phase>(phase);
  const [ticker, setTicker] = useState<TickerItem[]>([]);

  useEffect(() => {
    if (phase === 'running' && previousPhaseRef.current !== 'running') {
      recordsRef.current = { e2e: Infinity, ttft: Infinity, tps: 0 };
      setTicker([]);
    }
    previousPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const messages: TickerItem[] = [];
    for (const run of runs) {
      if (run.status !== 'done' || !run.result) continue;
      const e2e = e2eMsOf(run.result);
      if (e2e != null && e2e < recordsRef.current.e2e) {
        recordsRef.current.e2e = e2e;
        messages.push({
          id: `${run.key}-e2e-${Math.round(e2e)}`,
          text: `E2E tercepat baru: ${run.model} · ${formatDuration(e2e)}`,
          tone: 'e2e',
        });
      }
      const ttft = run.result.ttftMs;
      if (ttft != null && ttft < recordsRef.current.ttft) {
        recordsRef.current.ttft = ttft;
        messages.push({
          id: `${run.key}-ttft-${Math.round(ttft)}`,
          text: `TTFT tercepat baru: ${run.model} · ${formatDuration(ttft)}`,
          tone: 'ttft',
        });
      }
      const tps = run.result.tps;
      if (tps != null && tps > recordsRef.current.tps) {
        recordsRef.current.tps = tps;
        messages.push({
          id: `${run.key}-tps-${Math.round(tps)}`,
          text: `TPS tertinggi baru: ${run.model} · ${formatTps(tps)} tok/s`,
          tone: 'tps',
        });
      }
    }
    if (messages.length) {
      setTicker((previous) => [...messages, ...previous].slice(0, 4));
    }
  }, [runs, phase]);

  if (!runs.length) return null;

  const done = runs
    .filter((run) => run.status === 'done' && run.result)
    .sort((a, b) => (e2eMsOf(a.result) ?? Infinity) - (e2eMsOf(b.result) ?? Infinity));

  if (phase === 'finished') {
    if (!done.length) return null;
    const podium = done.slice(0, 3);
    const order = [1, 0, 2].filter((index) => podium[index]);
    return (
      <section className="arena-stage podium-stage" aria-label="Podium hasil benchmark">
        <div className="arena-head">
          <div>
            <span className="eyebrow small">
              <Trophy size={14} />
              Podium akhir
            </span>
            <h3>Tiga model tercepat</h3>
          </div>
          <span className="arena-sub">Diurutkan dari latency E2E</span>
        </div>

        <div className="podium-grid">
          {order.map((index) => {
            const run = podium[index];
            if (!run) return null;
            const place = index + 1;
            return (
              <button
                type="button"
                key={run.key}
                className={`podium-card place-${place} ${
                  selectedKey === run.key ? 'is-selected' : ''
                }`}
                onClick={() => onSelect(selectedKey === run.key ? null : run.key)}
                onDoubleClick={() => onSpotlight?.(run.key)}
                aria-pressed={selectedKey === run.key}
                title="Klik untuk menyorot, klik dua kali untuk membuka fokus"
              >
                <span className="podium-medal">
                  {place === 1 ? <Crown size={20} /> : <Trophy size={18} />}
                  <em>#{place}</em>
                </span>
                <span className="podium-model" title={run.model}>
                  {run.model}
                </span>
                <span className="podium-provider">
                  {run.providerHost || run.providerLabel}
                </span>
                <strong className="podium-e2e">
                  <AnimatedNumber
                    value={e2eMsOf(run.result)}
                    format={(value) => formatDuration(value)}
                  />
                </strong>
                <span className="podium-split">
                  <span>
                    <Timer size={11} /> {formatDuration(run.result?.ttftMs)}
                  </span>
                  <span>
                    <Gauge size={11} /> {formatTps(run.result?.tps)}
                  </span>
                </span>
                {place === 1 && (
                  <span className="confetti" aria-hidden="true">
                    {Array.from({ length: 22 }, (_, index) => (
                      <i
                        key={index}
                        style={{
                          left: `${(index * 37 + 13) % 100}%`,
                          animationDelay: `${(index % 9) * 0.11}s`,
                          background: LANE_COLORS[index % LANE_COLORS.length],
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="arena-footnote">
          <MousePointerClick size={12} />
          Klik kartu untuk menyorot · klik dua kali untuk membuka tampilan fokus
        </span>
      </section>
    );
  }

  if (phase !== 'running') return null;

  const maxChars = Math.max(1, ...runs.map((run) => run.content.length));
  const providers = [...new Set(runs.map((run) => run.providerId))];
  const colorFor = (providerId: string) => {
    return LANE_COLORS[Math.max(0, providers.indexOf(providerId)) % LANE_COLORS.length];
  };

  return (
    <section className="arena-stage live-stage" aria-label="Arena benchmark langsung">
      <div className="arena-head">
        <div>
          <span className="eyebrow small">
            <Activity size={14} />
            Live arena
          </span>
          <h3>Model sedang berlomba</h3>
        </div>
        <span className="arena-sub">
          <span className="live-pulse" />
          {runs.filter((run) => run.status === 'done').length}/{runs.length} selesai
        </span>
      </div>

      <div className="arena-lanes">
        {runs.map((run, index) => {
          const progress = progressFor(run, maxChars);
          const selected = selectedKey === run.key;
          return (
            <button
              type="button"
              key={run.key}
              className={`arena-lane status-${run.status} ${selected ? 'is-selected' : ''}`}
              onClick={() => onSelect(selected ? null : run.key)}
              onDoubleClick={() => onSpotlight?.(run.key)}
              aria-pressed={selected}
              title={`${run.providerHost || run.providerLabel} · ${run.model}`}
            >
              <span className={`arena-rank ${index === 0 ? 'first' : ''}`}>
                {run.status === 'done' ? (
                  <CheckCircle2 size={13} />
                ) : run.status === 'error' ? (
                  <AlertTriangle size={13} />
                ) : run.status === 'queued' ? (
                  index + 1
                ) : (
                  <LoaderCircle size={13} className="spin" />
                )}
              </span>
              <span className="arena-name">
                <strong>{run.model}</strong>
                <small>{run.providerHost || run.providerLabel}</small>
              </span>
              <span className="arena-track">
                <span
                  className="arena-fill"
                  style={{
                    width: `${progress}%`,
                    background: run.status === 'error' ? 'var(--red)' : colorFor(run.providerId),
                  }}
                />
                <span className="arena-spark" style={{ left: `${progress}%` }} />
              </span>
              <span className="arena-stat">
                {run.status === 'done' || run.status === 'streaming' ? (
                  <AnimatedNumber
                    value={
                      run.status === 'done'
                        ? e2eMsOf(run.result)
                        : Math.round(run.content.length / 4)
                    }
                    format={(value) =>
                      run.status === 'done' ? formatDuration(value) : `${Math.round(value)} tok`
                    }
                  />
                ) : (
                  laneStatus(run)
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="arena-ticker" aria-live="polite">
        {ticker.length ? (
          ticker.map((item) => (
            <span className={`ticker-item tone-${item.tone}`} key={item.id}>
              {item.tone === 'e2e' && <Zap size={11} />}
              {item.tone === 'ttft' && <Timer size={11} />}
              {item.tone === 'tps' && <Gauge size={11} />}
              {item.text}
            </span>
          ))
        ) : (
          <span className="ticker-idle">
            <Activity size={11} />
            Menunggu hasil pertama — rekor akan muncul di sini.
          </span>
        )}
      </div>
    </section>
  );
}
