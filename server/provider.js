import { encode } from 'gpt-tokenizer';
import { performance } from 'node:perf_hooks';

const MODELS_TIMEOUT_MS = 25_000;
const CHAT_TIMEOUT_MS = 180_000;
const CHAT_VALIDATE_TIMEOUT_MS = 60_000;
const MAX_ERROR_CHARS = 700;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 800;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRYABLE_STATUSES = new Set([429, 503]);
const ZERO_WIDTH_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const SURROUNDING_QUOTES = /^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019]+$/g;

/**
 * Membersihkan key yang sering tersalin beserta prefix, kutip, atau karakter tak terlihat.
 * Contoh yang diperbaiki: `Bearer tip_xxx`, `"tip_xxx"`, key dengan newline/tab/zero-width.
 */
export function normalizeApiKey(raw) {
  let key = String(raw ?? '').replace(ZERO_WIDTH_CHARS, '').trim();
  if (!key) return '';

  key = key.replace(SURROUNDING_QUOTES, '').trim();
  key = key.replace(/^authorization\s*:\s*/i, '').trim();
  while (/^bearer[\s:]+/i.test(key)) {
    key = key.replace(/^bearer[\s:]+/i, '').trim();
  }
  key = key.replace(SURROUNDING_QUOTES, '');
  key = key.replace(/\s+/g, '');
  return key.replace(SURROUNDING_QUOTES, '');
}

export class ProviderError extends Error {
  constructor(message, { status = 0, code = 'provider_error', details = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sanitizeMessage(value, apiKey = '') {
  let text = typeof value === 'string' ? value : String(value ?? '');
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  text = text.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

export function normalizeBaseUrl(raw) {
  let input = String(raw ?? '').trim();
  if (!input) throw new ProviderError('API Base URL wajib diisi.', { code: 'invalid_url' });

  if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(input)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(input);
    input = `${isLocal ? 'http' : 'https'}://${input}`;
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new ProviderError('Format API Base URL tidak valid.', { code: 'invalid_url' });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ProviderError('API Base URL harus menggunakan http:// atau https://.', {
      code: 'invalid_url',
    });
  }

  url.hash = '';
  url.search = '';
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(chat\/completions|completions|models)$/i, '');
  path = path.replace(/\/+$/, '');
  url.pathname = path || '/';
  const normalized = url.toString().replace(/\/$/, '');
  return normalized;
}

export function buildBaseCandidates(raw) {
  const base = normalizeBaseUrl(raw);
  const parsed = new URL(base);
  const candidates = [base];

  if (parsed.pathname === '/' || parsed.pathname === '') {
    const v1 = new URL(base);
    v1.pathname = '/v1';
    candidates.push(v1.toString().replace(/\/$/, ''));
  }

  return [...new Set(candidates)];
}

function endpoint(base, suffix) {
  return `${base.replace(/\/$/, '')}/${suffix}`;
}

function timeoutSignal(ms, parentSignal) {
  const timeout = AbortSignal.timeout(ms);
  return parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
}

function isAbortError(error, parentSignal) {
  return Boolean(parentSignal?.aborted) || error?.name === 'AbortError';
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.code === 'ABORT_ERR';
}

/**
 * Menghormati header Retry-After (detik atau tanggal HTTP) bila ada.
 * Nilainya dibatasi agar antrean tidak tertahan terlalu lama.
 */
function retryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), RETRY_MAX_DELAY_MS);
  }
  const timestamp = Date.parse(header);
  if (Number.isFinite(timestamp)) {
    return Math.min(Math.max(0, timestamp - Date.now()), RETRY_MAX_DELAY_MS);
  }
  return null;
}

function retryDelayMs(attempt, retryAfterHeader) {
  const suggested = retryAfterMs(retryAfterHeader);
  if (suggested != null) return suggested;
  const exponential = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_DELAY_MS);
  // Jitter 75–125% mencegah beberapa model menabrak provider pada saat yang sama.
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

function delayWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('Permintaan dibatalkan.', { code: 'aborted' }));
      return;
    }
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError('Permintaan dibatalkan.', { code: 'aborted' }));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function summarizeValues(values) {
  const clean = values
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!clean.length) {
    return { count: 0, min: null, max: null, mean: null, median: null, stdev: null };
  }
  const count = clean.length;
  const mean = clean.reduce((sum, value) => sum + value, 0) / count;
  const middle = Math.floor(count / 2);
  const median = count % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const round = (value) => Number(value.toFixed(2));
  return {
    count,
    min: clean[0],
    max: clean[count - 1],
    mean: round(mean),
    median: round(median),
    stdev: round(Math.sqrt(variance)),
  };
}

export function summarizeSamples(samples) {
  const e2eValues = samples.map((sample) => sample.e2eMs ?? sample.totalMs);
  const generationValues = samples.map((sample) =>
    sample.generationMs ?? Math.max(0, (sample.e2eMs ?? sample.totalMs) - (sample.ttftMs ?? 0)),
  );

  return {
    // `totalMs` dipertahankan sebagai alias agar riwayat/ekspor lama tetap terbaca.
    e2eMs: summarizeValues(e2eValues),
    totalMs: summarizeValues(e2eValues),
    generationMs: summarizeValues(generationValues),
    ttftMs: summarizeValues(samples.map((sample) => sample.ttftMs)),
    tps: summarizeValues(samples.map((sample) => sample.tps)),
    completionTokens: summarizeValues(samples.map((sample) => sample.completionTokens)),
  };
}

/**
 * Metrik utama memakai median tiap metrik agar konsisten dengan tabel statistik,
 * sedangkan teks jawaban diambil dari sampel terpanjang agar tidak terpotong.
 */
export function aggregateSamples(samples) {
  const stats = summarizeSamples(samples);
  const ordered = [...samples].sort(
    (a, b) => (a.e2eMs ?? a.totalMs) - (b.e2eMs ?? b.totalMs),
  );
  const medianSample = ordered[Math.floor((ordered.length - 1) / 2)];
  const answerSample = samples.reduce(
    (best, sample) => (sample.content.length > best.content.length ? sample : best),
    samples[0],
  );
  const e2eMs = stats.e2eMs.median ?? medianSample.e2eMs ?? medianSample.totalMs;
  const ttftMs = stats.ttftMs.median ?? medianSample.ttftMs;
  const tps = stats.tps.median ?? medianSample.tps;
  const generationMs =
    stats.generationMs.median ?? Math.max(0, e2eMs - (ttftMs ?? 0));
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


function friendlyNetworkError(error, parentSignal) {
  if (isAbortError(error, parentSignal)) {
    throw new ProviderError('Permintaan dibatalkan.', { code: 'aborted' });
  }
  if (isTimeoutError(error)) {
    throw new ProviderError('Waktu koneksi ke provider habis.', { code: 'timeout' });
  }

  const cause = error?.cause || {};
  const code = cause.code || error?.code || '';
  const messages = {
    ENOTFOUND: 'Domain provider tidak ditemukan. Periksa kembali Base URL.',
    ECONNREFUSED: 'Koneksi ditolak. Pastikan server provider berjalan dan port-nya benar.',
    ECONNRESET: 'Koneksi ke provider terputus.',
    ETIMEDOUT: 'Koneksi ke provider melewati batas waktu.',
    CERT_HAS_EXPIRED: 'Sertifikat SSL provider sudah kedaluwarsa.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Sertifikat SSL provider tidak tepercaya.',
  };
  throw new ProviderError(messages[code] || `Gagal terhubung ke provider${code ? ` (${code})` : ''}.`, {
    code: 'network_error',
    details: sanitizeMessage(cause.message || error?.message),
  });
}

async function readResponseText(response, maxBytes = 1_000_000) {
  try {
    const text = await response.text();
    return text.slice(0, maxBytes);
  } catch {
    return '';
  }
}

export function parseModels(payload) {
  let items = [];
  if (Array.isArray(payload)) items = payload;
  else if (Array.isArray(payload?.data)) items = payload.data;
  else if (Array.isArray(payload?.models)) items = payload.models;
  else if (Array.isArray(payload?.data?.models)) items = payload.data.models;

  const seen = new Set();
  const models = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? item.model ?? item.name ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const contextLength = firstNumber(
      item.context_length,
      item.context_window,
      item.max_context_length,
      item.max_model_len,
      item.top_provider?.context_length,
      item.limits?.context,
      item.meta?.n_ctx_train,
    );

    models.push({
      id,
      name: String(item.display_name ?? item.name ?? item.id ?? id),
      ownedBy: item.owned_by ?? item.owned_by_name ?? item.publisher ?? undefined,
      contextLength: contextLength || undefined,
      created: typeof item.created === 'number' ? item.created : undefined,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }));
  return models;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function providerErrorInfo(status, rawBody, apiKey = '', endpointKind = 'models') {
  let detail = sanitizeMessage(rawBody, apiKey);
  try {
    const parsed = JSON.parse(rawBody);
    const candidate =
      parsed?.error?.message ||
      parsed?.error?.detail ||
      parsed?.message ||
      parsed?.detail ||
      parsed?.error;
    if (typeof candidate === 'string') detail = sanitizeMessage(candidate, apiKey);
  } catch {
    // The body is not JSON; the truncated plain text is still useful.
  }

  if (status === 401) {
    return {
      message: 'API key ditolak provider (401 Unauthorized). Periksa kembali key Anda.',
      detail,
    };
  }
  if (status === 403) {
    return {
      message: 'API key tidak memiliki izin untuk mengakses endpoint ini (403 Forbidden).',
      detail,
    };
  }
  if (status === 404 || status === 405) {
    if (endpointKind === 'chat') {
      return {
        message:
          'Endpoint chat/completions tidak ditemukan, atau ID model tidak tersedia di provider ini.',
        detail,
      };
    }
    return {
      message:
        'Endpoint /models tidak ditemukan. Pastikan Base URL mengarah ke API OpenAI-compatible (biasanya berakhiran /v1).',
      detail: '',
    };
  }
  if (status === 429) {
    return {
      message: 'Rate limit provider tercapai (429). Tunggu sebentar lalu coba lagi.',
      detail,
    };
  }
  if (status >= 500) {
    return {
      message: `Provider mengalami masalah server (${status}).${detail ? ` ${detail}` : ''}`,
      detail,
    };
  }
  return {
    message: `Provider menolak permintaan (${status}).${detail ? ` ${detail}` : ''}`,
    detail,
  };
}

async function fetchModelsAt(baseUrl, apiKey, signal) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(endpoint(baseUrl, 'models'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: timeoutSignal(MODELS_TIMEOUT_MS, signal),
    });
  } catch (error) {
    friendlyNetworkError(error, signal);
  }

  const latencyMs = Math.round(performance.now() - started);
  const raw = await readResponseText(response);
  if (!response.ok) {
    const info = providerErrorInfo(response.status, raw, apiKey);
    const error = new ProviderError(info.message, {
      status: response.status,
      code: response.status === 401 || response.status === 403 ? 'invalid_key' : 'models_failed',
      details: info.detail,
    });
    error.raw = raw;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new ProviderError('Respons daftar model bukan JSON yang valid.', {
      status: response.status,
      code: 'invalid_response',
      details: sanitizeMessage(raw),
    });
  }

  return { baseUrl, latencyMs, models: parseModels(payload) };
}

export async function validateProvider({ baseUrl, apiKey, signal }) {
  const candidates = buildBaseCandidates(baseUrl);
  let lastError;

  for (const candidate of candidates) {
    try {
      const result = await fetchModelsAt(candidate, apiKey, signal);
      const host = new URL(result.baseUrl).host;
      return {
        ok: true,
        valid: true,
        keyStatus: 'valid',
        baseUrl: result.baseUrl,
        host,
        latencyMs: result.latencyMs,
        modelCount: result.models.length,
        verifiedVia: 'models',
        message: `API key valid. ${result.models.length} model terdeteksi.`,
      };
    } catch (error) {
      lastError = error;
      if (
        error?.code === 'invalid_key' ||
        error?.code === 'network_error' ||
        error?.code === 'timeout' ||
        error?.code === 'aborted'
      ) {
        break;
      }
      if (![404, 405].includes(error?.status)) break;
    }
  }

  const status = lastError?.status || 0;
  const invalidKey = lastError?.code === 'invalid_key';
  return {
    ok: false,
    valid: false,
    keyStatus: invalidKey ? 'invalid' : 'unknown',
    httpStatus: status,
    baseUrl: normalizeBaseUrl(baseUrl),
    host: new URL(normalizeBaseUrl(baseUrl)).host,
    latencyMs: null,
    modelCount: null,
    verifiedVia: 'models',
    message:
      lastError?.message ||
      'Tidak dapat memverifikasi API key melalui endpoint /models pada provider ini.',
    details: lastError?.details || undefined,
  };
}

export async function loadProviderModels({ baseUrl, apiKey, signal }) {
  const candidates = buildBaseCandidates(baseUrl);
  let lastError;

  for (const candidate of candidates) {
    try {
      const result = await fetchModelsAt(candidate, apiKey, signal);
      return {
        ok: true,
        baseUrl: result.baseUrl,
        host: new URL(result.baseUrl).host,
        latencyMs: result.latencyMs,
        models: result.models,
      };
    } catch (error) {
      lastError = error;
      if (
        error?.code === 'invalid_key' ||
        error?.code === 'network_error' ||
        error?.code === 'timeout' ||
        error?.code === 'aborted'
      ) {
        break;
      }
      if (![404, 405].includes(error?.status)) break;
    }
  }

  throw lastError || new ProviderError('Daftar model tidak tersedia.');
}

/**
 * Verifikasi cadangan ketika provider membatasi /models tetapi endpoint chat tetap berfungsi.
 * Hanya satu permintaan chat kecil yang dikirim, dengan model yang dipilih pengguna.
 */
export async function validateProviderWithChat({ baseUrl, apiKey, model, signal }) {
  const candidates = buildBaseCandidates(baseUrl);
  const started = performance.now();
  let lastError;

  for (const candidate of candidates) {
    try {
      const result = await benchmarkModel({
        baseUrl: candidate,
        apiKey,
        model,
        prompt: 'Balas dengan satu kata: OK',
        systemPrompt: '',
        temperature: 0,
        maxTokens: 16,
        signal,
        timeoutMs: CHAT_VALIDATE_TIMEOUT_MS,
      });

      return {
        ok: true,
        valid: true,
        keyStatus: 'valid',
        baseUrl: candidate,
        host: new URL(candidate).host,
        latencyMs: Math.round(performance.now() - started),
        modelCount: null,
        verifiedVia: 'chat',
        model,
        message: `API key valid. Model ${model} merespons lewat chat.`,
        details: sanitizeMessage(result.content || result.reasoning || '', apiKey) || undefined,
      };
    } catch (error) {
      lastError = error;
      if (
        error?.code === 'invalid_key' ||
        error?.code === 'network_error' ||
        error?.code === 'timeout' ||
        error?.code === 'aborted'
      ) {
        break;
      }
      if (![404, 405].includes(error?.status)) break;
    }
  }

  const status = lastError?.status || 0;
  const invalidKey = lastError?.code === 'invalid_key';
  return {
    ok: false,
    valid: false,
    keyStatus: invalidKey ? 'invalid' : 'unknown',
    httpStatus: status,
    baseUrl: normalizeBaseUrl(baseUrl),
    host: new URL(normalizeBaseUrl(baseUrl)).host,
    latencyMs: null,
    modelCount: null,
    verifiedVia: 'chat',
    model,
    message: lastError?.message || 'Verifikasi lewat chat tidak berhasil.',
    details: lastError?.details || undefined,
  };
}

function createChatBody({ model, prompt, systemPrompt, temperature, maxTokens, includeUsage }) {
  const messages = [];
  if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
  messages.push({ role: 'user', content: prompt });

  return {
    model,
    messages,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
  };
}

async function requestChat({
  baseUrl,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
  signal,
  timeoutMs = CHAT_TIMEOUT_MS,
  onRetry,
}) {
  const url = endpoint(baseUrl, 'chat/completions');
  let lastError;
  let retries = 0;

  for (const includeUsage of [true, false]) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (signal?.aborted) {
        throw new ProviderError('Permintaan dibatalkan.', { code: 'aborted' });
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(
            createChatBody({ model, prompt, systemPrompt, temperature, maxTokens, includeUsage }),
          ),
          signal: timeoutSignal(timeoutMs, signal),
        });

        if (response.ok) return { response, retries };

        const raw = await readResponseText(response);
        const info = providerErrorInfo(response.status, raw, apiKey, 'chat');
        const error = new ProviderError(info.message, {
          status: response.status,
          code: response.status === 401 || response.status === 403 ? 'invalid_key' : 'chat_failed',
          details: info.detail,
        });

        // Sebagian provider menolak stream_options; ulangi tanpa opsi tersebut.
        if (includeUsage && [400, 422].includes(response.status)) {
          lastError = error;
          break;
        }

        if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
          const delayMs = retryDelayMs(attempt + 1, response.headers.get('retry-after'));
          retries += 1;
          onRetry?.({
            attempt: retries,
            status: response.status,
            delayMs,
            message: info.message,
          });
          await delayWithAbort(delayMs, signal);
          continue;
        }

        error.retries = retries;
        throw error;
      } catch (error) {
        if (error instanceof ProviderError) {
          error.retries = retries;
          throw error;
        }
        if (signal?.aborted) {
          throw new ProviderError('Permintaan dibatalkan.', { code: 'aborted' });
        }
        if (attempt < MAX_RETRIES) {
          const delayMs = retryDelayMs(attempt + 1, null);
          retries += 1;
          onRetry?.({
            attempt: retries,
            status: 0,
            delayMs,
            message: 'Koneksi ke provider gagal, mencoba ulang.',
          });
          await delayWithAbort(delayMs, signal);
          continue;
        }
        friendlyNetworkError(error, signal);
      }
    }
  }

  if (lastError) lastError.retries = retries;
  throw lastError || new ProviderError('Permintaan chat gagal.', { retries });
}

function contentFromDelta(delta) {
  if (delta == null) return { content: '', reasoning: '' };
  if (typeof delta === 'string') return { content: delta, reasoning: '' };

  const normalizePart = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((part) => {
          if (typeof part === 'string') return part;
          return part?.text ?? part?.content ?? '';
        })
        .join('');
    }
    return '';
  };

  return {
    content: normalizePart(delta.content ?? delta.text),
    reasoning: normalizePart(
      delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? delta.reasoning_details,
    ),
  };
}

function usageFromPayload(payload) {
  const usage = payload?.usage ?? payload?.x_groq?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens);
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return null;
  return {
    promptTokens: Number.isFinite(prompt) ? prompt : undefined,
    completionTokens: Number.isFinite(completion) ? completion : undefined,
    totalTokens:
      Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : undefined,
  };
}

async function consumeSse(response, onEvent, signal) {
  if (!response.body) {
    throw new ProviderError('Provider mengirim respons kosong.', { code: 'empty_response' });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];
  let finished = false;

  const flushEvent = () => {
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data.trim() === '[DONE]') {
      finished = true;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      // Ignore provider keep-alives and malformed intermediate events.
      return;
    }
    onEvent(payload);
  };

  const processLine = (line) => {
    if (finished) return;
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!clean) {
      flushEvent();
      return;
    }
    if (clean.startsWith(':')) return;
    if (clean.startsWith('data:')) {
      dataLines.push(clean.slice(5).trimStart());
      return;
    }
    if (clean.startsWith('{')) {
      flushEvent();
      let payload;
      try {
        payload = JSON.parse(clean);
      } catch {
        // Ignore non-JSON lines.
        return;
      }
      onEvent(payload);
    }
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        processLine(line);
        if (finished) break;
      }
    }
    if (!finished && buffer) processLine(buffer);
    if (!finished) flushEvent();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (isAbortError(error, signal)) {
      throw new ProviderError('Permintaan dibatalkan.', { code: 'aborted' });
    }
    throw new ProviderError('Koneksi streaming terputus sebelum respons selesai.', {
      code: 'stream_error',
      details: sanitizeMessage(error?.message),
    });
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The connection may already be closed.
    }
  }
}

export async function benchmarkModel({
  baseUrl,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
  signal,
  timeoutMs,
  onFirstToken,
  onDelta,
  onRetry,
}) {
  const started = performance.now();
  const { response, retries } = await requestChat({
    baseUrl,
    apiKey,
    model,
    prompt,
    systemPrompt,
    temperature,
    maxTokens,
    signal,
    timeoutMs,
    onRetry,
  });

  const contentType = response.headers.get('content-type') || '';
  const streaming = !contentType.includes('application/json');
  let content = '';
  let reasoning = '';
  let usage = null;
  let ttftMs = null;
  let lastTokenAt = null;
  let tokenEvents = 0;

  const consumePayload = (payload) => {
    if (payload?.error) {
      const message = payload.error.message || payload.error.detail || 'Provider mengembalikan error.';
      throw new ProviderError(sanitizeMessage(message, apiKey), {
        code: 'provider_stream_error',
        details: sanitizeMessage(JSON.stringify(payload.error), apiKey),
      });
    }

    const nextUsage = usageFromPayload(payload);
    if (nextUsage) usage = { ...usage, ...nextUsage };

    const choice = payload?.choices?.[0];
    if (!choice) return;

    const delta = choice.delta ?? choice.message ?? {};
    const { content: nextContent, reasoning: nextReasoning } = contentFromDelta(delta);
    const legacyText = !nextContent && !nextReasoning ? contentFromDelta(choice.text) : null;
    const addedContent = nextContent || legacyText?.content || '';
    const addedReasoning = nextReasoning || '';
    if (!addedContent && !addedReasoning) return;

    const now = performance.now();
    const firstToken = ttftMs === null;
    if (firstToken) {
      ttftMs = Math.max(0, now - started);
      onFirstToken?.(ttftMs);
    }

    content += addedContent;
    reasoning += addedReasoning;
    lastTokenAt = now;
    tokenEvents += 1;
    onDelta?.({
      content: addedContent,
      reasoning: addedReasoning,
      elapsedMs: Math.round(now - started),
      ttftMs: ttftMs === null ? null : Math.round(ttftMs),
    });
  };

  if (streaming) {
    await consumeSse(response, consumePayload, signal);
  } else {
    const raw = await readResponseText(response, 4_000_000);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ProviderError('Respons provider bukan JSON atau SSE yang valid.', {
        code: 'invalid_response',
        details: sanitizeMessage(raw, apiKey),
      });
    }
    consumePayload(payload);
  }

  const totalMs = Math.max(1, performance.now() - started);
  const e2eMs = Math.round(totalMs);
  const ttftRounded = ttftMs === null ? null : Math.round(ttftMs);
  // Latency E2E dipecah menjadi TTFT + durasi generasi hingga stream selesai.
  const generationMs = Math.max(0, e2eMs - (ttftRounded ?? 0));
  const completionTokens =
    usage?.completionTokens ?? (content || reasoning ? encode(content + reasoning).length : 0);
  const tokensEstimated = !Number.isFinite(usage?.completionTokens);

  let tpsWindowMs = totalMs;
  let tpsMethod = 'overall';
  if (streaming && tokenEvents > 1 && ttftMs !== null && lastTokenAt !== null) {
    const measured = lastTokenAt - (started + ttftMs);
    if (measured >= 20) {
      tpsWindowMs = measured;
      tpsMethod = 'generation';
    }
  }

  const tps =
    completionTokens > 0
      ? Number((completionTokens / (Math.max(tpsWindowMs, 1) / 1000)).toFixed(2))
      : null;

  return {
    content,
    reasoning,
    ttftMs: ttftRounded,
    totalMs: e2eMs,
    e2eMs,
    generationMs,
    completionTokens,
    promptTokens: usage?.promptTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    tokensEstimated,
    tps,
    tpsMethod,
    tpsReliable: tpsMethod === 'generation' && !tokensEstimated,
    streaming,
    tokenEvents,
    retries,
  };
}

export function providerErrorPayload(error, apiKey = '') {
  const isProviderError = error instanceof ProviderError;
  return {
    name: error?.name || 'Error',
    code: isProviderError ? error.code : 'unknown_error',
    status: isProviderError ? error.status : 0,
    message: isProviderError
      ? sanitizeMessage(error.message, apiKey)
      : sanitizeMessage(error?.message || 'Terjadi kesalahan tak terduga.', apiKey),
    details: isProviderError ? sanitizeMessage(error.details || '', apiKey) : '',
  };
}
