export interface ModelInfo {
  id: string;
  name: string;
  ownedBy?: string;
  contextLength?: number;
  created?: number;
  manual?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  valid: boolean;
  keyStatus: 'valid' | 'invalid' | 'unknown';
  baseUrl: string;
  host: string;
  latencyMs: number | null;
  modelCount: number | null;
  message: string;
  details?: string;
  httpStatus?: number;
  verifiedVia?: 'models' | 'chat';
  model?: string;
  keyAdjusted?: boolean;
}

export interface ModelsResult {
  ok: boolean;
  baseUrl: string;
  host: string;
  latencyMs: number;
  models: ModelInfo[];
  message?: string;
  keyAdjusted?: boolean;
}

export interface BenchmarkProviderInput {
  id: string;
  label?: string;
  baseUrl: string;
  resolvedBaseUrl?: string;
  apiKey: string;
  models: string[];
}

export interface BenchmarkRequest {
  providers: BenchmarkProviderInput[];
  prompt: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  concurrency: number;
  repetitions: number;
}

export interface ModelResult {
  content: string;
  reasoning: string;
  ttftMs: number | null;
  /** Alias lama dari `e2eMs`, dipertahankan untuk riwayat/ekspor versi sebelumnya. */
  totalMs: number;
  /** Latency E2E: prompt dikirim hingga seluruh jawaban selesai (ms). */
  e2eMs?: number;
  /** Durasi generasi setelah token pertama hingga stream selesai (ms). */
  generationMs?: number;
  completionTokens: number;
  promptTokens: number | null;
  totalTokens: number | null;
  tokensEstimated: boolean;
  tps: number | null;
  tpsMethod: 'generation' | 'overall';
  tpsReliable: boolean;
  streaming: boolean;
  tokenEvents: number;
  retries?: number;
}

export interface MetricStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stdev: number | null;
}

export interface RunStats {
  /** Statistik latency E2E (prompt terkirim → jawaban selesai). */
  e2eMs?: MetricStats;
  /** Statistik alias lama; nilainya sama dengan `e2eMs`. */
  totalMs: MetricStats;
  /** Statistik durasi generasi setelah token pertama. */
  generationMs?: MetricStats;
  ttftMs: MetricStats;
  tps: MetricStats;
  completionTokens: MetricStats;
}

export interface ProviderError {
  name: string;
  code: string;
  status: number;
  message: string;
  details?: string;
}

export type RunStatus = 'queued' | 'running' | 'streaming' | 'done' | 'error';

export interface BenchmarkRun {
  key: string;
  providerId: string;
  providerLabel: string;
  providerHost: string;
  model: string;
  status: RunStatus;
  content: string;
  reasoning: string;
  ttftMs: number | null;
  elapsedMs: number | null;
  result: ModelResult | null;
  error: ProviderError | null;
  samples: ModelResult[];
  stats: RunStats | null;
  retries: number;
  failedSamples: number;
  repetition: number;
  sampleTotal: number;
}

export interface BenchmarkJobMeta {
  key: string;
  providerId: string;
  providerLabel: string;
  providerHost: string;
  model: string;
}

export type BenchmarkEvent =
  | {
      type: 'start';
      startedAt: string;
      concurrency: number;
      repetitions: number;
      jobs: BenchmarkJobMeta[];
    }
  | ({ type: 'model_start' } & BenchmarkJobMeta)
  | ({ type: 'sample_start'; index: number; total: number } & BenchmarkJobMeta)
  | ({ type: 'first_token'; ttftMs: number; index: number } & BenchmarkJobMeta)
  | ({
      type: 'delta';
      content: string;
      reasoning: string;
      elapsedMs: number;
      ttftMs: number | null;
      index: number;
    } & BenchmarkJobMeta)
  | ({
      type: 'retry';
      attempt: number;
      sample: number;
      status: number;
      delayMs: number;
      message: string;
    } & BenchmarkJobMeta)
  | ({ type: 'sample_done'; index: number; total: number; result: ModelResult } & BenchmarkJobMeta)
  | ({
      type: 'done';
      result: ModelResult;
      samples: ModelResult[];
      stats: RunStats;
      retries: number;
      failedSamples: number;
    } & BenchmarkJobMeta)
  | ({
      type: 'model_error';
      error: ProviderError;
      retries: number;
      failedSamples: number;
    } & BenchmarkJobMeta)
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'complete';
      totalMs: number;
      completed: number;
      total: number;
      retries: number;
    };

export type Phase = 'idle' | 'running' | 'finished';
