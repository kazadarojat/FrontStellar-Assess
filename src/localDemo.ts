import type {
  BenchmarkEvent,
  BenchmarkJobMeta,
  BenchmarkRequest,
  MetricStats,
  ModelResult,
  RunStats,
} from './types';

interface DemoProfile {
  id: string;
  name: string;
  ttft: number;
  tps: number;
  reasoning: boolean;
}

const PROFILES: DemoProfile[] = [
  { id: 'demo-sprint', name: 'Demo Sprint', ttft: 60, tps: 42, reasoning: false },
  { id: 'demo-turbo', name: 'Demo Turbo', ttft: 150, tps: 64, reasoning: false },
  { id: 'demo-mini', name: 'Demo Mini', ttft: 40, tps: 16, reasoning: false },
  { id: 'demo-reasoner', name: 'Demo Reasoner', ttft: 320, tps: 24, reasoning: true },
];

function answerFor(profile: DemoProfile, prompt: string): string {
  const topic = String(prompt || '').slice(0, 90).replace(/\s+/g, ' ');
  const prefix = profile.reasoning
    ? 'Saya menimbang dua hal utama: waktu tunggu awal dan kecepatan produksi token. '
    : '';
  return `${prefix}**${profile.name}** menjawab prompt tentang “${topic}”.

Ini adalah **mode demo statis FrontStellar Assess**. Jawaban disimulasikan langsung di browser, jadi tidak ada biaya API dan tidak ada data yang dikirim ke mana pun.

- TTFT mengukur seberapa cepat token pertama muncul.
- TPS mengukur kecepatan token setelah token pertama.
- Latency E2E mengukur waktu penuh sampai jawaban selesai.

Gunakan tombol **Jalankan benchmark** untuk melihat arena, grafik, podium, dan statistik. Semua angka berasal dari simulasi lokal dan hanya untuk mencoba antarmuka.`;
}

function summarizeValues(values: Array<number | null>): MetricStats {
  const clean = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!clean.length) {
    return { count: 0, min: null, max: null, mean: null, median: null, stdev: null };
  }
  const count = clean.length;
  const mean = clean.reduce((sum, value) => sum + value, 0) / count;
  const middle = Math.floor(count / 2);
  const median = count % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const round = (value: number) => Number(value.toFixed(2));
  return {
    count,
    min: clean[0],
    max: clean[count - 1],
    mean: round(mean),
    median: round(median),
    stdev: round(Math.sqrt(variance)),
  };
}

function summarizeSamples(samples: ModelResult[]): RunStats {
  const e2eValues = samples.map((sample) => sample.e2eMs ?? sample.totalMs);
  const generationValues = samples.map(
    (sample) =>
      sample.generationMs ?? Math.max(0, (sample.e2eMs ?? sample.totalMs) - (sample.ttftMs ?? 0)),
  );
  return {
    e2eMs: summarizeValues(e2eValues),
    totalMs: summarizeValues(e2eValues),
    generationMs: summarizeValues(generationValues),
    ttftMs: summarizeValues(samples.map((sample) => sample.ttftMs)),
    tps: summarizeValues(samples.map((sample) => sample.tps)),
    completionTokens: summarizeValues(samples.map((sample) => sample.completionTokens)),
  };
}

function aggregateSamples(samples: ModelResult[]): { result: ModelResult; stats: RunStats } {
  const stats = summarizeSamples(samples);
  const ordered = [...samples].sort(
    (a, b) => (a.e2eMs ?? a.totalMs) - (b.e2eMs ?? b.totalMs),
  );
  const medianSample = ordered[Math.floor((ordered.length - 1) / 2)];
  const answerSample = samples.reduce(
    (best, sample) => (sample.content.length > best.content.length ? sample : best),
    samples[0],
  );
  const e2eMs = stats.e2eMs?.median ?? medianSample.e2eMs ?? medianSample.totalMs;
  const ttftMs = stats.ttftMs.median ?? medianSample.ttftMs;
  const tps = stats.tps.median ?? medianSample.tps;
  const generationMs = stats.generationMs?.median ?? Math.max(0, e2eMs - (ttftMs ?? 0));
  const completionTokens =
    stats.completionTokens.median == null
      ? medianSample.completionTokens
      : Math.round(stats.completionTokens.median);

  return {
    result: {
      ...medianSample,
      e2eMs,
      totalMs: e2eMs,
      ttftMs,
      generationMs,
      tps,
      completionTokens,
      content: answerSample.content || medianSample.content,
      reasoning: answerSample.reasoning || medianSample.reasoning,
    },
    stats,
  };
}

function abortError(): DOMException {
  return new DOMException('Pengujian dihentikan oleh pengguna.', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function simulateSample(
  profile: DemoProfile,
  prompt: string,
  meta: BenchmarkJobMeta,
  onEvent: (event: BenchmarkEvent) => void,
  signal?: AbortSignal,
): Promise<ModelResult> {
  const jitter = 0.88 + Math.random() * 0.24;
  const ttft = Math.round(profile.ttft * jitter);
  const tpsTarget = profile.tps * (0.92 + Math.random() * 0.16);
  const delay = Math.max(10, Math.round(1000 / tpsTarget));
  const started = performance.now();

  await sleep(ttft, signal);
  onEvent({ type: 'first_token', ...meta, index: 1, ttftMs: ttft });

  let reasoning = '';
  let content = '';
  let tokenEvents = 0;

  if (profile.reasoning) {
    const reasoningText =
      'Membaca prompt. Memilih struktur jawaban singkat. Menyiapkan metrik yang relevan. ';
    for (const part of reasoningText.split(/(?<=\s)/)) {
      await sleep(12, signal);
      reasoning += part;
      onEvent({
        type: 'delta',
        ...meta,
        content: '',
        reasoning: part,
        elapsedMs: Math.round(performance.now() - started),
        ttftMs: ttft,
        index: 1,
      });
    }
  }

  const words = answerFor(profile, prompt).split(/(\s+)/).filter(Boolean);
  for (let index = 0; index < words.length; index += 2) {
    if (signal?.aborted) throw abortError();
    const delta = words.slice(index, index + 2).join('');
    if (!delta) continue;
    await sleep(delay, signal);
    tokenEvents += 1;
    content += delta;
    onEvent({
      type: 'delta',
      ...meta,
      content: delta,
      reasoning: '',
      elapsedMs: Math.round(performance.now() - started),
      ttftMs: ttft,
      index: 1,
    });
  }

  const e2eMs = Math.round(performance.now() - started);
  const generationMs = Math.max(0, e2eMs - ttft);
  const tps = generationMs > 0 ? (tokenEvents / generationMs) * 1000 : null;

  return {
    content,
    reasoning,
    ttftMs: ttft,
    totalMs: e2eMs,
    e2eMs,
    generationMs,
    completionTokens: tokenEvents,
    promptTokens: 40,
    totalTokens: 40 + tokenEvents,
    tokensEstimated: false,
    tps: tps == null ? null : Number(tps.toFixed(2)),
    tpsMethod: 'generation',
    tpsReliable: tokenEvents > 1 && generationMs >= 250,
    streaming: true,
    tokenEvents,
    retries: 0,
  };
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Menjalankan benchmark demo sepenuhnya di browser.
 * Dipakai di GitHub Pages, tempat backend Express tidak tersedia.
 */
export async function streamLocalDemo(
  input: BenchmarkRequest,
  onEvent: (event: BenchmarkEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const jobs: BenchmarkJobMeta[] = input.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: `${provider.id}::${model}`,
      providerId: provider.id,
      providerLabel: provider.label || 'Demo statis',
      providerHost: 'browser',
      model,
    })),
  );

  const repetitions = Math.max(1, Math.round(input.repetitions));
  const startedAt = performance.now();
  const startedIso = new Date().toISOString();

  onEvent({
    type: 'start',
    startedAt: startedIso,
    concurrency: Math.max(1, Math.round(input.concurrency)),
    repetitions,
    jobs,
  });

  let completed = 0;

  await runPool(
    jobs,
    Math.max(1, Math.round(input.concurrency)),
    async (job) => {
      onEvent({ type: 'model_start', ...job });
      const profile = PROFILES.find((item) => item.id === job.model) ?? PROFILES[0];
      const samples: ModelResult[] = [];

      for (let index = 0; index < repetitions; index += 1) {
        if (signal?.aborted) return;
        onEvent({ type: 'sample_start', ...job, index: index + 1, total: repetitions });
        const result = await simulateSample(profile, input.prompt, job, onEvent, signal);
        samples.push(result);
        onEvent({
          type: 'sample_done',
          ...job,
          index: index + 1,
          total: repetitions,
          result,
        });
      }

      if (!samples.length) return;
      const { result, stats } = aggregateSamples(samples);
      onEvent({
        type: 'done',
        ...job,
        result,
        samples,
        stats,
        retries: 0,
        failedSamples: 0,
      });

      completed += 1;
      onEvent({ type: 'progress', completed, total: jobs.length });
    },
    signal,
  );

  if (!signal?.aborted) {
    onEvent({
      type: 'complete',
      totalMs: Math.round(performance.now() - startedAt),
      completed,
      total: jobs.length,
      retries: 0,
    });
  }
}
