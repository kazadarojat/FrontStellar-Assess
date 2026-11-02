import { useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock3,
  Download,
  FileJson,
  Gauge,
  GitCompare,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Pin,
  PinOff,
  RotateCcw,
  Sparkles,
  Table2,
  Timer,
  Trophy,
} from 'lucide-react';
import type { BenchmarkRun, ModelResult, Phase } from '../types';
import { e2eMsOf, formatDuration, formatTokens, formatTps } from '../format';
import ResultCard, { type Award } from './ResultCard';
import MetricCharts from './MetricCharts';
import LiveArena from './LiveArena';
import SpotlightModal from './SpotlightModal';
import CompareDrawer from './CompareDrawer';

interface ResultsPanelProps {
  runs: BenchmarkRun[];
  phase: Phase;
  completed: number;
  total: number;
  wallTotalMs: number | null;
  runError: string | null;
  wasStopped: boolean;
  concurrency: number;
  repetitions: number;
  retries: number;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportPng: () => void;
  onRetryFailed: (keys?: string[]) => void;
  retryDisabled?: boolean;
}

interface Winner {
  key: string;
  model: string;
  providerLabel: string;
  providerHost: string;
  value: number;
  result: ModelResult;
}

type SortKey = 'e2e' | 'ttft' | 'tps' | 'tokens' | 'provider' | 'model';
type SortDir = 'asc' | 'desc';

interface SortOption {
  key: SortKey;
  label: string;
  defaultDir: SortDir;
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'e2e', label: 'Latency E2E', defaultDir: 'asc' },
  { key: 'ttft', label: 'TTFT', defaultDir: 'asc' },
  { key: 'tps', label: 'TPS', defaultDir: 'desc' },
  { key: 'tokens', label: 'Token', defaultDir: 'desc' },
  { key: 'provider', label: 'Provider', defaultDir: 'asc' },
  { key: 'model', label: 'Model', defaultDir: 'asc' },
];

function sortValue(run: BenchmarkRun, key: SortKey): number | string | null {
  if (!run.result) return null;
  switch (key) {
    case 'e2e':
      return e2eMsOf(run.result);
    case 'ttft':
      return run.result.ttftMs;
    case 'tps':
      return run.result.tps;
    case 'tokens':
      return run.result.completionTokens;
    case 'provider':
      return run.providerLabel;
    case 'model':
      return run.model;
    default:
      return null;
  }
}

function sortRuns(runs: BenchmarkRun[], key: SortKey, dir: SortDir): BenchmarkRun[] {
  const direction = dir === 'asc' ? 1 : -1;
  return [...runs].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);

    if (typeof left === 'string' || typeof right === 'string') {
      const compared = String(left ?? '').localeCompare(String(right ?? ''), 'id', {
        numeric: true,
        sensitivity: 'base',
      });
      return compared * direction;
    }

    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return (left - right) * direction;
  });
}

function directionLabel(key: SortKey, dir: SortDir): string {
  if (key === 'provider' || key === 'model') return dir === 'asc' ? 'A → Z' : 'Z → A';
  if (key === 'e2e' || key === 'ttft') {
    return dir === 'asc' ? 'tercepat → terlama' : 'terlama → tercepat';
  }
  return dir === 'asc' ? 'terendah → tertinggi' : 'tertinggi → terendah';
}

function ariaSort(key: SortKey, activeKey: SortKey, dir: SortDir): 'ascending' | 'descending' | 'none' {
  if (key !== activeKey) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={11} />;
  return dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
}


function pickMin(
  runs: BenchmarkRun[],
  selector: (result: ModelResult) => number | null,
  mode: 'min' | 'max',
): Winner | null {
  let winner: Winner | null = null;
  for (const run of runs) {
    if (run.status !== 'done' || !run.result) continue;
    const value = selector(run.result);
    if (value == null || !Number.isFinite(value)) continue;
    if (
      !winner ||
      (mode === 'min' && value < winner.value) ||
      (mode === 'max' && value > winner.value)
    ) {
      winner = {
        key: run.key,
        model: run.model,
        providerLabel: run.providerLabel,
        providerHost: run.providerHost,
        value,
        result: run.result,
      };
    }
  }
  return winner;
}

export default function ResultsPanel({
  runs,
  phase,
  completed,
  total,
  wallTotalMs,
  runError,
  wasStopped,
  concurrency,
  repetitions,
  retries,
  onExportCsv,
  onExportJson,
  onExportPng,
  onRetryFailed,
  retryDisabled = false,
}: ResultsPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>('e2e');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [baselineKey, setBaselineKey] = useState('');
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null);

  const successRuns = runs
    .filter((run) => run.status === 'done' && run.result)
    .sort((a, b) => (e2eMsOf(a.result) ?? Infinity) - (e2eMsOf(b.result) ?? Infinity));
  const otherRuns = runs.filter((run) => run.status !== 'done');
  const failedRuns = runs.filter((run) => run.status === 'error');
  const providerCount = new Set(runs.map((run) => run.providerId)).size;

  const winnerE2e = pickMin(successRuns, (result) => e2eMsOf(result), 'min');
  const winnerTps = pickMin(successRuns, (result) => result.tps, 'max');
  const winnerTtft = pickMin(successRuns, (result) => result.ttftMs, 'min');

  const rankMap = new Map(successRuns.map((run, index) => [run.key, index + 1]));
  const activeSort = SORT_OPTIONS.find((item) => item.key === sortKey) ?? SORT_OPTIONS[0];
  const sortedSuccessRuns = sortRuns(successRuns, sortKey, sortDir);
  const displayRuns = phase === 'running' ? runs : [...sortedSuccessRuns, ...otherRuns];
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const parallelLabel = concurrency <= 1 ? 'satu per satu' : `${concurrency} model bersamaan`;

  const pinnedRuns = pinnedKeys
    .map((key) => runs.find((run) => run.key === key))
    .filter((run): run is BenchmarkRun => Boolean(run && run.status === 'done' && run.result));
  const effectiveBaseline = pinnedRuns.some((run) => run.key === baselineKey)
    ? baselineKey
    : pinnedRuns[0]?.key ?? '';
  const spotlightRun = runs.find((run) => run.key === spotlightKey) ?? null;

  function togglePin(key: string) {
    setPinnedKeys((previous) => {
      if (previous.includes(key)) return previous.filter((item) => item !== key);
      return [...previous, key].slice(-3);
    });
  }

  function handleSort(key: SortKey) {
    const option = SORT_OPTIONS.find((item) => item.key === key) ?? SORT_OPTIONS[0];
    if (key === sortKey) {
      setSortDir((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(option.defaultDir);
  }

  function toggleHighlight(key: string) {
    setHighlightKey((previous) => (previous === key ? null : key));
  }

  function awardsFor(key: string): Award[] {
    const awards: Award[] = [];
    if (winnerE2e?.key === key) awards.push({ key: 'total', label: 'E2E tercepat' });
    if (winnerTps?.key === key) awards.push({ key: 'tps', label: 'TPS tertinggi' });
    if (winnerTtft?.key === key) awards.push({ key: 'ttft', label: 'TTFT tercepat' });
    return awards;
  }

  const winnerCards = [
    {
      key: 'total' as const,
      label: 'Latency E2E tercepat',
      description: 'Prompt terkirim hingga jawaban selesai',
      icon: Clock3,
      winner: winnerE2e,
      value: winnerE2e ? formatDuration(winnerE2e.value) : '—',
    },
    {
      key: 'tps' as const,
      label: 'TPS tertinggi',
      description: 'Generasi token paling cepat',
      icon: Gauge,
      winner: winnerTps,
      value: winnerTps
        ? `${!winnerTps.result.tpsReliable ? '≈' : ''}${formatTps(winnerTps.value)}`
        : '—',
      unit: 'token/detik',
    },
    {
      key: 'ttft' as const,
      label: 'TTFT tercepat',
      description: 'Token pertama paling responsif',
      icon: Timer,
      winner: winnerTtft,
      value: winnerTtft ? formatDuration(winnerTtft.value) : '—',
    },
  ];

  return (
    <section className="results-section" id="results">
      <div className="results-heading">
        <div>
          <div className="eyebrow small">
            <Sparkles size={14} />
            Hasil pengujian
          </div>
          <h2>{phase === 'running' ? 'Benchmark sedang berjalan' : 'Arena perbandingan model'}</h2>
          <p>
            {phase === 'running'
              ? `Setiap model menerima prompt yang sama, dijalankan ${parallelLabel}. Jawaban muncul saat stream diterima.`
              : wasStopped
                ? `${successRuns.length} model selesai · ${runs.length - successRuns.length} dihentikan sebelum selesai. Jawaban parsial tetap dapat dibandingkan.`
                : `${successRuns.length} dari ${total} model berhasil diuji${providerCount > 1 ? ` dari ${providerCount} provider` : ''}${failedRuns.length > 0 ? ` · ${failedRuns.length} model gagal dapat diulang` : ''}. Bandingkan performa dan kualitas jawabannya di bawah.`}
          </p>
        </div>
        {phase === 'finished' && runs.length > 0 && (
          <div className="results-actions">
            <button type="button" className="button secondary small-button" onClick={onExportPng}>
              <ImageIcon size={15} />
              PNG
            </button>
            <button type="button" className="button secondary small-button" onClick={onExportCsv}>
              <Download size={15} />
              CSV
            </button>
            <button type="button" className="button secondary small-button" onClick={onExportJson}>
              <FileJson size={15} />
              JSON
            </button>
          </div>
        )}
      </div>

      {phase === 'running' && (
        <div className="benchmark-progress">
          <div className="progress-top">
            <span className="progress-label">
              <LoaderCircle size={16} className="spin" />
              Menguji {total} model · {parallelLabel}
            </span>
            <span className="progress-count">
              {completed}/{total}
            </span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${Math.max(percent, 3)}%` }} />
          </div>
          <div className="progress-caption">
            <span>
              {concurrency <= 1
                ? 'Model berikutnya dimulai setelah model sebelumnya selesai.'
                : `${concurrency} model berjalan bersamaan; sisanya menunggu antrean.`}
              {repetitions > 1 && ` Setiap model diulang ${repetitions}×.`}
            </span>
            <span>{percent}%</span>
          </div>
        </div>
      )}

      {phase === 'finished' && (
        <div className={`run-summary ${wasStopped || runError ? 'warning' : 'success'}`}>
          {wasStopped || runError ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <strong>
              {wasStopped
                ? 'Pengujian dihentikan'
                : runError
                  ? 'Pengujian selesai dengan catatan'
                  : 'Pengujian selesai'}
            </strong>
            <span>
              {runError ||
                (wasStopped
                  ? 'Sebagian model mungkin belum selesai. Hasil parsial tetap ditampilkan.'
                  : `${successRuns.length} model berhasil · total waktu dinding ${formatDuration(wallTotalMs)}.`)}
              {retries > 0 && ` ${retries} permintaan diulang otomatis (429/503/backoff).`}
            </span>
          </div>
        </div>
      )}

      {phase === 'finished' && failedRuns.length > 0 && (
        <div className="retry-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>{failedRuns.length} model gagal diuji</strong>
            <span>
              Ulangi hanya model yang gagal tanpa menjalankan ulang model yang sudah berhasil.
              Pastikan provider masih terverifikasi dan API key masih terisi.
            </span>
          </div>
          <button
            type="button"
            className="button secondary small-button"
            onClick={() => onRetryFailed()}
            disabled={retryDisabled}
          >
            <RotateCcw size={14} />
            Ulangi {failedRuns.length} model gagal
          </button>
        </div>
      )}

      <LiveArena
        runs={runs}
        phase={phase}
        selectedKey={highlightKey}
        onSelect={setHighlightKey}
        onSpotlight={setSpotlightKey}
      />

      {successRuns.length > 0 && (
        <>
          <div className="winner-grid">
            {winnerCards.map((card) => {
              const Icon = card.icon;
              return (
                <article className={`winner-card winner-${card.key}`} key={card.key}>
                  <div className="winner-card-head">
                    <span className="winner-icon">
                      <Icon size={17} />
                    </span>
                    <span>{card.label}</span>
                    <Trophy size={14} className="winner-trophy" />
                  </div>
                  <strong className="winner-model" title={card.winner?.model}>
                    {card.winner?.model || '—'}
                  </strong>
                  {card.winner && (
                    <span className="winner-provider">
                      {card.winner.providerHost || card.winner.providerLabel}
                    </span>
                  )}
                  <div className="winner-value">
                    {card.value}
                    {card.unit && <span>{card.unit}</span>}
                  </div>
                  <p>{card.description}</p>
                </article>
              );
            })}
          </div>

          <div className="metric-definition">
            <Info size={15} />
            <p>
              <strong>Latency E2E</strong> = waktu penuh dari prompt dikirim hingga seluruh jawaban
              selesai di-stream (termasuk retry, tanpa waktu antrean). <strong>Generasi</strong> =
              durasi dari token pertama diterima hingga stream selesai (E2E − TTFT per sampel).{' '}
              <strong>TTFT</strong> = waktu hingga token pertama diterima.{' '}
              <strong>TPS</strong> = token output per detik setelah token pertama. Tanda{' '}
              <strong>≈</strong> menandakan estimasi token atau TPS yang tidak dapat diukur secara
              presisi.
              {repetitions > 1 &&
                ` Nilai utama adalah median dari ${repetitions} pengulangan; statistik lengkap ada di setiap kartu.`}
            </p>
          </div>

          <div className="sort-bar">
            <span className="sort-bar-label">
              <ArrowUpDown size={14} />
              Urutkan model
            </span>
            <div
              className="sort-options"
              role="group"
              aria-label="Urutkan model berdasarkan parameter uji"
            >
              {SORT_OPTIONS.map((option) => {
                const active = sortKey === option.key;
                return (
                  <button
                    type="button"
                    key={option.key}
                    className={`sort-chip ${active ? 'active' : ''}`}
                    aria-pressed={active}
                    title={`Urutkan berdasarkan ${option.label}`}
                    onClick={() => handleSort(option.key)}
                  >
                    {option.label}
                    <SortIcon active={active} dir={sortDir} />
                  </button>
                );
              })}
            </div>
            <span className="sort-caption">
              {directionLabel(sortKey, sortDir)} · tabel &amp; kartu
            </span>
          </div>

          {pinnedRuns.length > 0 && (
            <div className="pin-bar">
              <span className="pin-bar-label">
                <Pin size={14} />
                Disematkan {pinnedRuns.length}/3
              </span>
              <div className="pin-chips">
                {pinnedRuns.map((run) => (
                  <span className={`pin-chip ${effectiveBaseline === run.key ? 'is-baseline' : ''}`} key={run.key}>
                    <button
                      type="button"
                      className="pin-chip-name"
                      onClick={() => setBaselineKey(run.key)}
                      title={
                        effectiveBaseline === run.key
                          ? 'Baseline perbandingan'
                          : 'Jadikan baseline perbandingan'
                      }
                    >
                      {run.model}
                      {effectiveBaseline === run.key && <em>baseline</em>}
                    </button>
                    <button
                      type="button"
                      className="pin-chip-remove"
                      onClick={() => togglePin(run.key)}
                      aria-label={`Lepas pin ${run.model}`}
                    >
                      <PinOff size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="button secondary small-button"
                onClick={() => setCompareOpen(true)}
                disabled={pinnedRuns.length < 2}
                title={
                  pinnedRuns.length < 2
                    ? 'Pin minimal dua model untuk membandingkan'
                    : 'Bandingkan model yang dipin'
                }
              >
                <GitCompare size={14} />
                Bandingkan
              </button>
            </div>
          )}

          <MetricCharts
            runs={successRuns}
            selectedKey={highlightKey}
            onSelect={setHighlightKey}
          />

          {phase === 'finished' && (
            <div className="comparison-table-card">
              <div className="table-card-heading">
                <div>
                  <span className="eyebrow small">
                    <Table2 size={14} />
                    Data mentah
                  </span>
                  <h3>Tabel perbandingan</h3>
                </div>
                <span className="table-caption">
                  Urut: {activeSort.label} · {directionLabel(sortKey, sortDir)}
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th aria-sort={ariaSort('provider', sortKey, sortDir)}>
                        <button
                          type="button"
                          className={`th-sort ${sortKey === 'provider' ? 'active' : ''}`}
                          onClick={() => handleSort('provider')}
                        >
                          Provider
                          <SortIcon active={sortKey === 'provider'} dir={sortDir} />
                        </button>
                      </th>
                      <th aria-sort={ariaSort('model', sortKey, sortDir)}>
                        <button
                          type="button"
                          className={`th-sort ${sortKey === 'model' ? 'active' : ''}`}
                          onClick={() => handleSort('model')}
                        >
                          Model
                          <SortIcon active={sortKey === 'model'} dir={sortDir} />
                        </button>
                      </th>
                      <th aria-sort={ariaSort('ttft', sortKey, sortDir)}>
                        <button
                          type="button"
                          className={`th-sort ${sortKey === 'ttft' ? 'active' : ''}`}
                          onClick={() => handleSort('ttft')}
                        >
                          TTFT
                          <SortIcon active={sortKey === 'ttft'} dir={sortDir} />
                        </button>
                      </th>
                      <th aria-sort={ariaSort('tps', sortKey, sortDir)}>
                        <button
                          type="button"
                          className={`th-sort ${sortKey === 'tps' ? 'active' : ''}`}
                          onClick={() => handleSort('tps')}
                        >
                          TPS
                          <SortIcon active={sortKey === 'tps'} dir={sortDir} />
                        </button>
                      </th>
                      <th aria-sort={ariaSort('e2e', sortKey, sortDir)}>
                        <button
                          type="button"
                          className={`th-sort ${sortKey === 'e2e' ? 'active' : ''}`}
                          onClick={() => handleSort('e2e')}
                        >
                          E2E
                          <SortIcon active={sortKey === 'e2e'} dir={sortDir} />
                        </button>
                      </th>
                      <th aria-sort={ariaSort('tokens', sortKey, sortDir)}>
                        <button
                          type="button"
                          className={`th-sort ${sortKey === 'tokens' ? 'active' : ''}`}
                          onClick={() => handleSort('tokens')}
                        >
                          Token
                          <SortIcon active={sortKey === 'tokens'} dir={sortDir} />
                        </button>
                      </th>
                      <th>Retry</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRuns.map((run) => {
                      const result = run.result;
                      const rank = rankMap.get(run.key);
                      const isE2e = winnerE2e?.key === run.key;
                      const isTps = winnerTps?.key === run.key;
                      const isTtft = winnerTtft?.key === run.key;
                      const highlighted = highlightKey === run.key;
                      return (
                        <tr
                          key={run.key}
                          className={highlighted ? 'is-highlighted' : ''}
                          tabIndex={0}
                          onClick={() => toggleHighlight(run.key)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            toggleHighlight(run.key);
                          }}
                          title="Klik untuk menyorot model ini"
                        >
                          <td className="rank-cell">{rank ? `#${rank}` : '—'}</td>
                          <td>
                            <span className="table-provider" title={run.providerHost}>
                              {run.providerLabel}
                            </span>
                          </td>
                          <td>
                            <span className="table-model" title={run.model}>
                              {run.model}
                            </span>
                          </td>
                          <td className={isTtft ? 'best-cell' : ''}>
                            {formatDuration(result?.ttftMs)}
                          </td>
                          <td className={isTps ? 'best-cell' : ''}>
                            {result?.tps != null
                              ? `${!result.tpsReliable ? '≈' : ''}${formatTps(result.tps)}`
                              : '—'}
                          </td>
                          <td className={isE2e ? 'best-cell' : ''}>
                            {formatDuration(e2eMsOf(result))}
                          </td>
                          <td>
                            {result
                              ? formatTokens(result.completionTokens, result.tokensEstimated)
                              : '—'}
                          </td>
                          <td>
                            {run.retries > 0 ? (
                              <span className="table-retry">
                                <RotateCcw size={11} />
                                {run.retries}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <span className={`table-status ${run.status}`}>
                              {run.status === 'done' ? 'Selesai' : run.status === 'error' ? 'Gagal' : 'Berjalan'}
                            </span>
                            {run.status === 'error' && (
                              <button
                                type="button"
                                className="table-retry-action"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onRetryFailed([run.key]);
                                }}
                                onKeyDown={(event) => event.stopPropagation()}
                                disabled={retryDisabled}
                                aria-label={`Ulangi ${run.model}`}
                                title="Ulangi model ini"
                              >
                                <RotateCcw size={11} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {successRuns.length === 0 && phase === 'finished' && !wasStopped && (
        <div className="no-success">
          <AlertTriangle size={22} />
          <div>
            <strong>Tidak ada model yang berhasil diuji</strong>
            <p>Periksa ID model, kuota provider, atau parameter pengujian lalu coba lagi.</p>
          </div>
        </div>
      )}

      <div className="answers-heading">
        <div>
          <span className="eyebrow small">
            <Sparkles size={14} />
            Head-to-head
          </span>
          <h3>Bandingkan jawaban</h3>
        </div>
        <span className="answers-count">
          {runs.length} model{providerCount > 1 ? ` · ${providerCount} provider` : ''}
        </span>
      </div>

      <div className="result-grid">
        {displayRuns.map((run) => (
          <ResultCard
            key={run.key}
            run={run}
            rank={rankMap.get(run.key) ?? null}
            awards={awardsFor(run.key)}
            highlighted={highlightKey === run.key}
            pinned={pinnedKeys.includes(run.key)}
            onTogglePin={togglePin}
            onSpotlight={setSpotlightKey}
            onRetry={onRetryFailed}
            retryDisabled={retryDisabled}
          />
        ))}
      </div>

      {spotlightRun && (
        <SpotlightModal
          run={spotlightRun}
          onClose={() => setSpotlightKey(null)}
          onRetry={(key) => onRetryFailed([key])}
          retryDisabled={retryDisabled}
        />
      )}

      {compareOpen && pinnedRuns.length >= 2 && (
        <CompareDrawer
          runs={pinnedRuns}
          baselineKey={effectiveBaseline}
          onBaseline={setBaselineKey}
          onRemove={togglePin}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </section>
  );
}
