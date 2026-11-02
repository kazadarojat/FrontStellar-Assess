import express from 'express';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  aggregateSamples,
  benchmarkModel,
  loadProviderModels,
  normalizeApiKey,
  providerErrorPayload,
  normalizeBaseUrl,
  sanitizeMessage,
  validateProvider,
  validateProviderWithChat,
} from './provider.js';
import { createDemoRouter } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_MODELS = 100;
const MAX_PROVIDERS = 6;
const MAX_CONCURRENCY = 20;
const MAX_REPETITIONS = 10;
const MAX_PROMPT_LENGTH = 40_000;

const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function apiError(res, status, message, extra = {}) {
  return res.status(status).json({ ok: false, message, ...extra });
}

function cleanCredentials(body) {
  const baseUrl = String(body?.baseUrl ?? '').trim();
  const rawApiKey = String(body?.apiKey ?? '');
  const apiKey = normalizeApiKey(rawApiKey);
  const keyAdjusted = apiKey !== rawApiKey.trim();
  if (!baseUrl) {
    throw new Error('API Base URL wajib diisi.');
  }
  if (baseUrl.length > 2_048) {
    throw new Error('API Base URL terlalu panjang.');
  }
  if (apiKey.length > 8_192) {
    throw new Error('API key terlalu panjang.');
  }
  return { baseUrl, apiKey, keyAdjusted };
}

function uniqueModels(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((model) => String(model ?? '').trim())
        .filter(Boolean),
    ),
  ];
}

function cleanBenchmarkProviders(body) {
  const rawProviders = Array.isArray(body?.providers) ? body.providers : [];
  const entries = rawProviders.length
    ? rawProviders
    : [
        {
          id: 'provider-1',
          label: 'Provider 1',
          baseUrl: body?.baseUrl,
          resolvedBaseUrl: body?.resolvedBaseUrl,
          apiKey: body?.apiKey,
          models: body?.models,
        },
      ];

  if (entries.length > MAX_PROVIDERS) {
    throw new Error(`Maksimal ${MAX_PROVIDERS} provider per pengujian.`);
  }

  const usedIds = new Set();
  return entries.map((entry, index) => {
    const baseUrl = String(entry?.baseUrl ?? '').trim();
    const resolvedBaseUrl = String(entry?.resolvedBaseUrl ?? '').trim() || baseUrl;
    const apiKey = normalizeApiKey(entry?.apiKey ?? '');
    const models = uniqueModels(entry?.models);

    if (!resolvedBaseUrl) {
      throw new Error(`API Base URL provider ${index + 1} wajib diisi.`);
    }
    if (resolvedBaseUrl.length > 2_048) {
      throw new Error(`API Base URL provider ${index + 1} terlalu panjang.`);
    }
    if (apiKey.length > 8_192) {
      throw new Error(`API key provider ${index + 1} terlalu panjang.`);
    }
    if (models.some((model) => model.length > 256)) {
      throw new Error(`ID model pada provider ${index + 1} terlalu panjang.`);
    }

    let id = String(entry?.id ?? '').trim().slice(0, 64) || `provider-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);

    return {
      id,
      label: String(entry?.label ?? '').trim().slice(0, 80) || `Provider ${index + 1}`,
      baseUrl,
      resolvedBaseUrl: normalizeBaseUrl(resolvedBaseUrl),
      apiKey,
      models,
    };
  });
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.allSettled(runners);
}


app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'FrontStellar Assess', version: APP_VERSION, demo: true });
});

app.use('/demo/v1', createDemoRouter());

app.post('/api/validate', async (req, res) => {
  let credentials;
  try {
    credentials = cleanCredentials(req.body);
  } catch (error) {
    return apiError(res, 400, error.message);
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const result = await validateProvider({ ...credentials, signal: controller.signal });
    return res.json({ ...result, keyAdjusted: credentials.keyAdjusted });
  } catch (error) {
    const payload = providerErrorPayload(error, credentials.apiKey);
    return res.status(500).json({
      ok: false,
      valid: false,
      keyStatus: 'unknown',
      message: payload.message,
      details: payload.details,
      keyAdjusted: credentials.keyAdjusted,
    });
  }
});

app.post('/api/models', async (req, res) => {
  let credentials;
  try {
    credentials = cleanCredentials(req.body);
  } catch (error) {
    return apiError(res, 400, error.message);
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const result = await loadProviderModels({ ...credentials, signal: controller.signal });
    return res.json({ ok: true, ...result, keyAdjusted: credentials.keyAdjusted });
  } catch (error) {
    const payload = providerErrorPayload(error, credentials.apiKey);
    return res
      .status(422)
      .json({ ok: false, ...payload, keyAdjusted: credentials.keyAdjusted });
  }
});

app.post('/api/validate-chat', async (req, res) => {
  let credentials;
  try {
    credentials = cleanCredentials(req.body);
  } catch (error) {
    return apiError(res, 400, error.message);
  }

  const model = String(req.body?.model ?? '').trim();
  if (!model) return apiError(res, 400, 'ID model wajib diisi untuk verifikasi lewat chat.');
  if (model.length > 256) return apiError(res, 400, 'ID model terlalu panjang.');

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const result = await validateProviderWithChat({
      ...credentials,
      model,
      signal: controller.signal,
    });
    return res.json({ ...result, keyAdjusted: credentials.keyAdjusted });
  } catch (error) {
    const payload = providerErrorPayload(error, credentials.apiKey);
    return res.status(500).json({
      ok: false,
      valid: false,
      keyStatus: 'unknown',
      message: payload.message,
      details: payload.details,
      keyAdjusted: credentials.keyAdjusted,
    });
  }
});

app.post('/api/benchmark', async (req, res) => {
  let providers;
  try {
    providers = cleanBenchmarkProviders(req.body);
  } catch (error) {
    return apiError(res, 400, error.message);
  }

  const prompt = String(req.body?.prompt ?? '').trim();
  const systemPrompt = String(req.body?.systemPrompt ?? '').trim();
  const temperature = Number(req.body?.temperature);
  const maxTokens = Number(req.body?.maxTokens);
  const concurrency = Math.max(
    1,
    Math.min(MAX_CONCURRENCY, Math.floor(Number(req.body?.concurrency)) || 1),
  );
  const repetitions = Math.max(
    1,
    Math.min(MAX_REPETITIONS, Math.floor(Number(req.body?.repetitions)) || 1),
  );
  const modelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);

  if (!modelCount) return apiError(res, 400, 'Pilih minimal satu model.');
  if (modelCount > MAX_MODELS) {
    return apiError(res, 400, `Maksimal ${MAX_MODELS} model per pengujian.`);
  }
  if (!prompt) return apiError(res, 400, 'Prompt wajib diisi.');
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return apiError(res, 400, `Prompt maksimal ${MAX_PROMPT_LENGTH.toLocaleString('id-ID')} karakter.`);
  }
  if (systemPrompt.length > MAX_PROMPT_LENGTH) {
    return apiError(res, 400, 'System prompt terlalu panjang.');
  }
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return apiError(res, 400, 'Temperature harus bernilai 0–2.');
  }
  if (!Number.isFinite(maxTokens) || maxTokens < 1 || maxTokens > 32_768) {
    return apiError(res, 400, 'Max token harus bernilai 1–32.768.');
  }

  // Kunci unik gabungan provider + model: ID model yang sama dapat muncul di beberapa provider.
  const jobs = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: `${provider.id}::${model}`,
      providerId: provider.id,
      providerLabel: provider.label,
      providerHost: (() => {
        try {
          return new URL(provider.resolvedBaseUrl).host;
        } catch {
          return provider.resolvedBaseUrl;
        }
      })(),
      model,
      resolvedBaseUrl: provider.resolvedBaseUrl,
      apiKey: provider.apiKey,
    })),
  );

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  });

  const send = (event) => {
    if (clientGone || res.writableEnded || res.destroyed) return false;
    res.write(`${JSON.stringify(event)}\n`);
    return true;
  };

  const runStarted = performance.now();
  send({
    type: 'start',
    startedAt: new Date().toISOString(),
    concurrency,
    repetitions,
    jobs: jobs.map(({ key, providerId, providerLabel, providerHost, model }) => ({
      key,
      providerId,
      providerLabel,
      providerHost,
      model,
    })),
  });

  let completed = 0;
  let totalRetries = 0;

  const runJob = async (job) => {
    if (clientGone || controller.signal.aborted) return;
    const meta = {
      key: job.key,
      providerId: job.providerId,
      providerLabel: job.providerLabel,
      providerHost: job.providerHost,
      model: job.model,
    };
    send({ type: 'model_start', ...meta });

    const samples = [];
    let retries = 0;
    let failedSamples = 0;
    let lastError = null;

    for (let index = 0; index < repetitions; index += 1) {
      if (clientGone || controller.signal.aborted) break;
      send({ type: 'sample_start', ...meta, index: index + 1, total: repetitions });

      try {
        const result = await benchmarkModel({
          baseUrl: job.resolvedBaseUrl,
          apiKey: job.apiKey,
          model: job.model,
          prompt,
          systemPrompt,
          temperature,
          maxTokens: Math.round(maxTokens),
          signal: controller.signal,
          onRetry: (retry) => {
            retries += 1;
            send({
              type: 'retry',
              ...meta,
              attempt: retries,
              sample: index + 1,
              status: retry.status,
              delayMs: retry.delayMs,
              message: sanitizeMessage(retry.message, job.apiKey),
            });
          },
          onFirstToken: (ttftMs) => {
            send({
              type: 'first_token',
              ...meta,
              index: index + 1,
              ttftMs: Math.round(ttftMs),
            });
          },
          onDelta: (delta) => {
            send({ type: 'delta', ...meta, index: index + 1, ...delta });
          },
        });

        samples.push(result);
        send({ type: 'sample_done', ...meta, index: index + 1, total: repetitions, result });
      } catch (error) {
        if (controller.signal.aborted) break;
        failedSamples += 1;
        lastError = error;
      }
    }

    totalRetries += retries;

    if (samples.length) {
      const { result, stats } = aggregateSamples(samples);
      send({
        type: 'done',
        ...meta,
        result: { ...result, retries },
        samples,
        stats,
        retries,
        failedSamples,
      });
    } else if (lastError) {
      send({
        type: 'model_error',
        ...meta,
        error: providerErrorPayload(lastError, job.apiKey),
        retries,
        failedSamples,
      });
    }

    completed += 1;
    send({ type: 'progress', completed, total: jobs.length });
  };

  await runPool(jobs, concurrency, runJob);

  if (!controller.signal.aborted) {
    send({
      type: 'complete',
      totalMs: Math.round(performance.now() - runStarted),
      completed,
      total: jobs.length,
      retries: totalRetries,
    });
    res.end();
  } else {
    try {
      res.end();
    } catch {
      // The client already disconnected.
    }
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, message: 'Endpoint API tidak ditemukan.' });
});

const distDir = path.join(__dirname, '..', 'dist');
const indexFile = path.join(distDir, 'index.html');
if (existsSync(indexFile)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) {
      return res.sendFile(indexFile);
    }
    return next();
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const message =
    error?.type === 'entity.too.large'
      ? 'Payload terlalu besar.'
      : sanitizeMessage(error?.message || 'Terjadi kesalahan pada server.');
  return res.status(error?.status || 500).json({ ok: false, message });
});

if (!process.env.VERCEL) app.listen(PORT, HOST, () => {
  console.log(`FrontStellar Assess API berjalan di http://localhost:${PORT} (bind ${HOST})`);
  if (!existsSync(indexFile)) {
    console.log('Frontend dev: jalankan Vite (npm run dev) untuk membuka antarmuka.');
  }
});

// Vercel serverless function imports the app without opening a listening port.
export default app;
