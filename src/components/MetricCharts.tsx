import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { BarChart3, Info, MousePointerClick, RotateCcw, Trophy, X } from 'lucide-react';
import type { BenchmarkRun } from '../types';
import {
  e2eMsOf,
  formatDuration,
  formatTokens,
  formatTps,
  generationMsOf,
  truncate,
} from '../format';

type MetricKey = 'total' | 'tps' | 'ttft';

interface MetricConfig {
  key: MetricKey;
  label: string;
  hint: string;
  lowerIsBetter: boolean;
}

const METRICS: MetricConfig[] = [
  {
    key: 'total',
    label: 'Latency E2E',
    hint: 'Waktu penuh dari prompt dikirim hingga seluruh jawaban selesai — semakin pendek semakin baik.',
    lowerIsBetter: true,
  },
  {
    key: 'tps',
    label: 'TPS',
    hint: 'Token output per detik setelah token pertama — semakin tinggi semakin baik.',
    lowerIsBetter: false,
  },
  {
    key: 'ttft',
    label: 'TTFT',
    hint: 'Waktu hingga token pertama diterima — semakin pendek semakin responsif.',
    lowerIsBetter: true,
  },
];

const PROVIDER_COLORS = ['#c9ff5c', '#62d9ff', '#ffb45f', '#ff7c7c', '#b58cff', '#6fe3a0'];

function metricValue(run: BenchmarkRun, key: MetricKey): number | null {
  if (!run.result) return null;
  const value =
    key === 'total'
      ? e2eMsOf(run.result)
      : key === 'tps'
        ? run.result.tps
        : run.result.ttftMs;
  return value == null || !Number.isFinite(value) ? null : value;
}

function formatMetric(key: MetricKey, run: BenchmarkRun, value: number): string {
  if (key === 'tps') return `${!run.result?.tpsReliable ? '≈' : ''}${formatTps(value)}`;
  return formatDuration(value);
}

function widthFor(value: number, min: number, max: number, lowerIsBetter: boolean): number {
  if (max === min) return 100;
  const goodness = lowerIsBetter ? (max - value) / (max - min) : (value - min) / (max - min);
  return 14 + Math.max(0, Math.min(1, goodness)) * 86;
}

function activationHandler(action: () => void) {
  return (event: ReactKeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  };
}

interface MetricChartsProps {
  runs: BenchmarkRun[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}

interface TooltipState {
  run: BenchmarkRun;
  x: number;
  y: number;
}

interface ScatterDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface BrushBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export default function MetricCharts({ runs, selectedKey = null, onSelect }: MetricChartsProps) {
  const [metric, setMetric] = useState<MetricKey>('total');
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(() => new Set());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [zoom, setZoom] = useState<ScatterDomain | null>(null);
  const [brush, setBrush] = useState<BrushBox | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const brushRef = useRef<BrushBox | null>(null);
  const brushStartRef = useRef<{ x: number; y: number } | null>(null);

  const config = METRICS.find((item) => item.key === metric) ?? METRICS[0];

  const doneRuns = runs.filter((run) => run.status === 'done' && run.result);
  const providerIds = [...new Set(doneRuns.map((run) => run.providerId))];
  const colorFor = (providerId: string) =>
    PROVIDER_COLORS[Math.max(0, providerIds.indexOf(providerId)) % PROVIDER_COLORS.length];
  const visibleRuns = doneRuns.filter((run) => !hiddenProviders.has(run.providerId));

  const entries = visibleRuns
    .map((run) => ({ run, value: metricValue(run, metric) }))
    .filter((entry): entry is { run: BenchmarkRun; value: number } => entry.value != null)
    .sort((a, b) => (config.lowerIsBetter ? a.value - b.value : b.value - a.value));

  const shown = entries.slice(0, 12);
  const values = shown.map((entry) => entry.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;

  // Skala log menekan jarak antar nilai ekstrem sehingga model yang lebih lambat tetap terlihat.
  const scaleValue = (value: number) => (logScale ? Math.log10(Math.max(1, value)) : value);
  const scaleMin = scaleValue(min);
  const scaleMax = scaleValue(max);

  const scatterPoints = visibleRuns
    .filter(
      (run) =>
        run.result &&
        run.result.ttftMs != null &&
        run.result.tps != null &&
        Number.isFinite(run.result.tps),
    )
    .sort((a, b) => (e2eMsOf(a.result) ?? 0) - (e2eMsOf(b.result) ?? 0));

  const maxTtft = Math.max(1, ...scatterPoints.map((run) => run.result?.ttftMs ?? 0));
  const maxTps = Math.max(1, ...scatterPoints.map((run) => run.result?.tps ?? 0));
  const domain: ScatterDomain = zoom ?? { xMin: 0, xMax: maxTtft, yMin: 0, yMax: maxTps };
  const spanX = Math.max(0.001, domain.xMax - domain.xMin);
  const spanY = Math.max(0.001, domain.yMax - domain.yMin);
  const plotX = (ttft: number) => 62 + ((ttft - domain.xMin) / spanX) * 590;
  const plotY = (tps: number) => 246 - ((tps - domain.yMin) / spanY) * 196;
  const visibleScatterPoints = scatterPoints.filter((run) => {
    const ttft = run.result?.ttftMs ?? 0;
    const tps = run.result?.tps ?? 0;
    return ttft >= domain.xMin && ttft <= domain.xMax && tps >= domain.yMin && tps <= domain.yMax;
  });

  const selectedRun = doneRuns.find((run) => run.key === selectedKey) ?? null;
  const selectionActive = selectedRun != null && !hiddenProviders.has(selectedRun.providerId);

  function select(key: string) {
    onSelect?.(selectedKey === key ? null : key);
  }

  function toggleProvider(providerId: string) {
    const hiding = !hiddenProviders.has(providerId);
    if (hiding && selectedRun?.providerId === providerId) onSelect?.(null);
    setHiddenProviders((previous) => {
      const next = new Set(previous);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
    setTooltip(null);
  }

  function showTooltip(element: Element, run: BenchmarkRun) {
    const rect = element.getBoundingClientRect();
    const half = 150;
    setTooltip({
      run,
      x: Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8),
      y: Math.max(rect.top - 10, 200),
    });
  }

  function svgPoint(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 680,
      y: ((event.clientY - rect.top) / rect.height) * 280,
    };
  }

  function insidePlot(point: { x: number; y: number }) {
    return point.x >= 62 && point.x <= 652 && point.y >= 50 && point.y <= 246;
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const point = svgPoint(event);
    if (!point || !insidePlot(point)) return;
    brushStartRef.current = point;
    const box = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    brushRef.current = box;
    setBrush(box);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer sintetis atau pointer yang sudah lepas dapat menolak capture.
    }
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const start = brushStartRef.current;
    if (!start) return;
    const point = svgPoint(event);
    if (!point) return;
    const box = {
      x0: start.x,
      y0: start.y,
      x1: Math.max(62, Math.min(652, point.x)),
      y1: Math.max(50, Math.min(246, point.y)),
    };
    brushRef.current = box;
    setBrush(box);
  }

  function handlePointerUp() {
    const start = brushStartRef.current;
    const box = brushRef.current;
    brushStartRef.current = null;
    brushRef.current = null;
    setBrush(null);
    if (!start || !box) return;

    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    if (right - left < 14 || bottom - top < 14) return;

    const toTtft = (px: number) => domain.xMin + ((px - 62) / 590) * spanX;
    const toTps = (py: number) => domain.yMin + ((246 - py) / 196) * spanY;
    const next = {
      xMin: toTtft(left),
      xMax: toTtft(right),
      yMin: toTps(bottom),
      yMax: toTps(top),
    };
    if (next.xMax - next.xMin > 0.001 && next.yMax - next.yMin > 0.001) {
      setZoom(next);
    }
  }

  function cancelBrush() {
    brushStartRef.current = null;
    brushRef.current = null;
    setBrush(null);
  }

  const hasLegend = providerIds.length > 1;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <span className="eyebrow small">
            <BarChart3 size={14} />
            Visualisasi hasil
          </span>
          <h3>Diagram perbandingan</h3>
        </div>
        <div className="chart-head-tools">
          <div className="chart-tabs" role="group" aria-label="Pilih metrik diagram">
            {METRICS.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={metric === item.key}
                className={`chart-tab ${metric === item.key ? 'active' : ''}`}
                onClick={() => setMetric(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`chart-scale ${logScale ? 'active' : ''}`}
            aria-pressed={logScale}
            onClick={() => setLogScale((previous) => !previous)}
            title="Alihkan skala linear dan logaritmik pada batang"
          >
            Skala log
          </button>
        </div>
      </div>

      <p className="chart-hint">
        <Info size={13} />
        <span>
          {config.hint}
          <span className="chart-hint-extra">
            <MousePointerClick size={11} />
            Klik batang atau titik untuk menyorot model, klik legenda provider untuk menyaring.
          </span>
          {logScale && (
            <span className="chart-hint-extra">
              Skala log aktif — perbedaan besar antar nilai dimampatkan agar model lambat tetap terbaca.
            </span>
          )}
        </span>
      </p>

      {hasLegend && (
        <div className="chart-legend" aria-label="Saring provider pada diagram">
          <span className="chart-legend-label">Provider</span>
          {providerIds.map((providerId) => {
            const sample = doneRuns.find((run) => run.providerId === providerId);
            const active = !hiddenProviders.has(providerId);
            const label = sample?.providerLabel || sample?.providerHost || providerId;
            const host = sample?.providerHost;
            return (
              <button
                type="button"
                key={providerId}
                className={`legend-chip ${active ? '' : 'is-off'}`}
                aria-pressed={active}
                title={`${active ? 'Sembunyikan' : 'Tampilkan'} ${label}`}
                onClick={() => toggleProvider(providerId)}
              >
                <i style={{ background: colorFor(providerId) }} />
                <span>{truncate(label, 24)}</span>
                {host && host !== label && <em>{truncate(host, 22)}</em>}
              </button>
            );
          })}
          {hiddenProviders.size > 0 && (
            <button
              type="button"
              className="legend-reset"
              onClick={() => {
                setHiddenProviders(new Set());
                setTooltip(null);
              }}
            >
              Tampilkan semua
            </button>
          )}
        </div>
      )}

      {selectionActive && selectedRun && (
        <div className="chart-selection">
          <MousePointerClick size={13} />
          <span>
            Disorot: <strong>{truncate(selectedRun.model, 40)}</strong>
            <em>{selectedRun.providerHost || selectedRun.providerLabel}</em>
          </span>
          <button type="button" className="chart-clear" onClick={() => onSelect?.(null)}>
            <X size={12} />
            Lepas
          </button>
        </div>
      )}

      {shown.length ? (
        <div className="chart-bars" role="group" aria-label={`Diagram ${config.label}`}>
          {shown.map((entry, index) => {
            const selected = selectedKey === entry.run.key;
            const dimmed = selectionActive && !selected;
            return (
              <div
                className={`chart-row clickable ${selected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''}`}
                key={entry.run.key}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${entry.run.model} dari ${entry.run.providerLabel}: ${formatMetric(metric, entry.run, entry.value)}`}
                onClick={() => select(entry.run.key)}
                onKeyDown={activationHandler(() => select(entry.run.key))}
                onMouseEnter={(event) => showTooltip(event.currentTarget, entry.run)}
                onMouseMove={(event) => showTooltip(event.currentTarget, entry.run)}
                onMouseLeave={() => setTooltip(null)}
                onFocus={(event) => showTooltip(event.currentTarget, entry.run)}
                onBlur={() => setTooltip(null)}
              >
                <span className={`chart-rank ${index === 0 ? 'first' : ''}`}>
                  {index === 0 ? <Trophy size={12} /> : index + 1}
                </span>
                <span className="chart-name" title={`${entry.run.providerHost} · ${entry.run.model}`}>
                  <strong>{truncate(entry.run.model, 34)}</strong>
                  <small>{truncate(entry.run.providerHost || entry.run.providerLabel, 30)}</small>
                </span>
                <span className="chart-track">
                  <span
                    className={`chart-fill ${index === 0 ? 'best' : ''}`}
                    style={{
                      width: `${widthFor(
                        scaleValue(entry.value),
                        scaleMin,
                        scaleMax,
                        config.lowerIsBetter,
                      )}%`,
                      background: index === 0 ? undefined : colorFor(entry.run.providerId),
                    }}
                  />
                </span>
                <span className={`chart-value ${index === 0 ? 'best' : ''}`}>
                  {formatMetric(metric, entry.run, entry.value)}
                </span>
              </div>
            );
          })}
          {entries.length > shown.length && (
            <span className="chart-more">
              Menampilkan 12 dari {entries.length} model terbaik untuk metrik ini.
            </span>
          )}
        </div>
      ) : (
        <p className="chart-empty">
          {doneRuns.length
            ? 'Semua provider sedang disembunyikan. Tampilkan lagi lewat legenda di atas.'
            : 'Belum ada metrik yang dapat digambarkan.'}
        </p>
      )}

      {scatterPoints.length >= 2 && (
        <div className="scatter-block">
          <div className="scatter-head">
            <div>
              <h4>Peta TTFT vs TPS</h4>
              <span>
                Kiri-atas = responsif dan cepat · seret area untuk memperbesar · klik titik untuk
                menyorot
              </span>
            </div>
            {zoom && (
              <button
                type="button"
                className="scatter-reset"
                onClick={() => setZoom(null)}
                title="Kembalikan peta ke skala penuh"
              >
                <RotateCcw size={12} />
                Reset zoom
              </button>
            )}
          </div>
          <div className={`scatter-wrap ${brush ? 'is-brushing' : ''}`}>
            <svg
              ref={svgRef}
              className="scatter"
              viewBox="0 0 680 280"
              role="group"
              aria-label="Diagram sebar TTFT versus TPS. Seret untuk memperbesar area."
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={cancelBrush}
              onPointerLeave={cancelBrush}
            >
              {[0, 1, 2, 3, 4].map((step) => {
                const y = 246 - (step / 4) * 196;
                const value = domain.yMin + (step / 4) * spanY;
                return (
                  <g key={step}>
                    <line x1="62" y1={y} x2="652" y2={y} className="scatter-grid" />
                    <text x="54" y={y + 3} className="scatter-tick" textAnchor="end">
                      {formatTps(value)}
                    </text>
                  </g>
                );
              })}
              {[0, 1, 2, 3, 4].map((step) => {
                const x = 62 + (step / 4) * 590;
                const value = domain.xMin + (step / 4) * spanX;
                return (
                  <g key={step}>
                    <line x1={x} y1="50" x2={x} y2="246" className="scatter-grid" />
                    <text x={x} y="264" className="scatter-tick" textAnchor="middle">
                      {formatDuration(value)}
                    </text>
                  </g>
                );
              })}
              <line x1="62" y1="246" x2="652" y2="246" className="scatter-axis" />
              <line x1="62" y1="50" x2="62" y2="246" className="scatter-axis" />
              <text x="357" y="278" className="scatter-label" textAnchor="middle">
                TTFT →
              </text>
              <text x="16" y="148" className="scatter-label" textAnchor="middle" transform="rotate(-90 16 148)">
                TPS →
              </text>

              {visibleScatterPoints.map((run) => {
                const ttft = run.result?.ttftMs ?? 0;
                const tps = run.result?.tps ?? 0;
                const x = plotX(ttft);
                const y = plotY(tps);
                const selected = selectedKey === run.key;
                const dimmed = selectionActive && !selected;
                return (
                  <g
                    key={run.key}
                    className={`scatter-point clickable ${selected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`${run.model} dari ${run.providerLabel}: TTFT ${formatDuration(ttft)}, TPS ${formatTps(tps)}`}
                    onClick={() => select(run.key)}
                    onKeyDown={activationHandler(() => select(run.key))}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseEnter={(event) => showTooltip(event.currentTarget, run)}
                    onMouseLeave={() => setTooltip(null)}
                    onFocus={(event) => showTooltip(event.currentTarget, run)}
                    onBlur={() => setTooltip(null)}
                  >
                    <circle cx={x} cy={y} r="6" fill={colorFor(run.providerId)} />
                    <circle cx={x} cy={y} r="11" fill={colorFor(run.providerId)} opacity="0.16" />
                    {selected && (
                      <text x={x} y={y - 16} className="scatter-point-label" textAnchor="middle">
                        {truncate(run.model, 22)}
                      </text>
                    )}
                  </g>
                );
              })}

              {brush && (
                <rect
                  className="scatter-brush"
                  x={Math.min(brush.x0, brush.x1)}
                  y={Math.min(brush.y0, brush.y1)}
                  width={Math.abs(brush.x1 - brush.x0)}
                  height={Math.abs(brush.y1 - brush.y0)}
                />
              )}
            </svg>
            {visibleScatterPoints.length === 0 && zoom && (
              <p className="scatter-empty">Tidak ada titik di area ini. Reset zoom untuk melihat semua.</p>
            )}
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="chart-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          <strong>{tooltip.run.model}</strong>
          <span className="tooltip-provider">
            {tooltip.run.providerLabel}
            {tooltip.run.providerHost && tooltip.run.providerHost !== tooltip.run.providerLabel
              ? ` · ${tooltip.run.providerHost}`
              : ''}
          </span>
          <dl>
            <dt>Latency E2E</dt>
            <dd>{formatDuration(e2eMsOf(tooltip.run.result))}</dd>
            <dt>Generasi</dt>
            <dd>{formatDuration(generationMsOf(tooltip.run.result))}</dd>
            <dt>TTFT</dt>
            <dd>{formatDuration(tooltip.run.result?.ttftMs ?? tooltip.run.ttftMs)}</dd>
            <dt>TPS</dt>
            <dd>
              {tooltip.run.result?.tps != null
                ? `${!tooltip.run.result.tpsReliable ? '≈' : ''}${formatTps(tooltip.run.result.tps)}`
                : '—'}
            </dd>
            <dt>Token output</dt>
            <dd>
              {tooltip.run.result
                ? formatTokens(
                    tooltip.run.result.completionTokens,
                    tooltip.run.result.tokensEstimated,
                  )
                : '—'}
            </dd>
          </dl>
          <span className="tooltip-hint">
            {selectedKey === tooltip.run.key ? 'Klik untuk melepas sorotan' : 'Klik untuk menyorot model ini'}
          </span>
        </div>
      )}
    </div>
  );
}
