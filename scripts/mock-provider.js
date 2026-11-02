/**
 * Mock provider OpenAI-compatible untuk mencoba FrontStellar Assess tanpa memakai API berbayar.
 * Jalankan dengan: npm run mock
 * Base URL: http://localhost:4010/v1
 * API key: demo-key
 */
import express from 'express';

const app = express();
const PORT = Number(process.env.MOCK_PORT) || 4010;
const API_KEY = 'demo-key';

const MODELS = [
  {
    id: 'mock-sprint',
    name: 'Mock Sprint',
    ttft: 70,
    tps: 38,
    words: 66,
    reasoning: false,
  },
  {
    id: 'mock-turbo',
    name: 'Mock Turbo',
    ttft: 180,
    tps: 62,
    words: 82,
    reasoning: false,
  },
  {
    id: 'mock-mini',
    name: 'Mock Mini',
    ttft: 45,
    tps: 14,
    words: 48,
    reasoning: false,
  },
  {
    id: 'mock-reasoner',
    name: 'Mock Reasoner',
    ttft: 340,
    tps: 22,
    words: 72,
    reasoning: true,
  },
  {
    id: 'mock-flaky',
    name: 'Mock Flaky 429',
    ttft: 110,
    tps: 28,
    words: 54,
    reasoning: false,
    retryOnce: true,
  },
  {
    id: 'mock-fail-once',
    name: 'Mock Gagal Sekali',
    ttft: 95,
    tps: 32,
    words: 58,
    reasoning: false,
    failOnce: true,
  },
];

app.use(express.json({ limit: '2mb' }));

function authorized(req) {
  return req.headers.authorization === `Bearer ${API_KEY}`;
}

app.get('/v1/models', (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ error: { message: 'Invalid API key.' } });
  }
  res.json({
    object: 'list',
    data: MODELS.map((model, index) => ({
      id: model.id,
      object: 'model',
      created: 1_735_000_000 + index,
      owned_by: 'modelbench-mock',
      context_length: 128_000,
    })),
  });
});

function answerFor(model, prompt) {
  const topic = String(prompt || '').slice(0, 90).replace(/\s+/g, ' ');
  const prefix =
    model.id === 'mock-reasoner'
      ? 'Saya akan menimbang dua konsep utama: waktu tunggu awal dan kecepatan produksi token. '
      : '';
  return `${prefix}**${model.name}** menjawab prompt tentang “${topic}”.

Latensi adalah waktu yang dibutuhkan sistem untuk mulai merespons. Throughput adalah banyaknya pekerjaan yang dapat diselesaikan per satuan waktu. Analoginya seperti restoran: latensi adalah waktu tunggu sampai hidangan pertama datang, sedangkan throughput adalah jumlah piring yang bisa disajikan tiap menit.

Untuk chatbot real-time, **TTFT** biasanya paling terasa oleh pengguna karena menentukan seberapa cepat balasan mulai muncul. Namun TPS tetap penting agar jawaban tidak terasa tersendat. Model ini sengaja diberi kecepatan berbeda untuk menguji metrik FrontStellar Assess.

- Total waktu: diukur sampai stream selesai.
- TTFT: diukur hingga token pertama.
- TPS: dihitung dari token output per detik generasi.

Semua jawaban berasal dari mock lokal, bukan model AI sungguhan.`;
}

app.post('/v1/chat/completions', async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ error: { message: 'Invalid API key.' } });
  }

  const model = MODELS.find((item) => item.id === req.body?.model);
  if (!model) {
    return res.status(404).json({ error: { message: `Model ${req.body?.model} tidak ditemukan.` } });
  }

  // Model khusus untuk menguji auto-retry 429 + backoff.
  if (model.retryOnce && !model.retried) {
    model.retried = true;
    res.setHeader('Retry-After', '1');
    return res.status(429).json({
      error: { message: 'Rate limit mock tercapai. Coba lagi setelah 1 detik.' },
    });
  }

  // Model khusus untuk menguji tombol "Ulangi model ini" (gagal sekali, lalu berhasil).
  if (model.failOnce && !model.failed) {
    model.failed = true;
    return res.status(500).json({
      error: { message: 'Kegagalan mock sekali. Ulangi model ini untuk melihat pemulihan.' },
    });
  }

  const prompt = req.body?.messages?.filter((message) => message.role === 'user').at(-1)?.content;
  const text = answerFor(model, prompt);
  const words = text.split(/(\s+)/).filter(Boolean);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const chunks = Math.max(3, Math.round(words.length / 2));
  const delay = Math.max(12, Math.round(1000 / model.tps));

  send({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    model: model.id,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  });

  await wait(model.ttft);

  if (model.reasoning) {
    const reasoningText =
      'Memeriksa definisi latensi dan throughput. Menyiapkan analogi restoran. Menyusun jawaban yang ringkas.';
    for (const part of reasoningText.split(/(?<=\s)/)) {
      send({
        choices: [{ index: 0, delta: { reasoning_content: part }, finish_reason: null }],
      });
      await wait(12);
    }
  }

  let completionTokens = 0;
  for (let index = 0; index < words.length; index += 2) {
    if (res.writableEnded || res.destroyed) return;
    const delta = words.slice(index, index + 2).join('');
    if (!delta) continue;
    completionTokens += 1;
    send({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      model: model.id,
      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    });
    await wait(delay);
  }

  send({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    model: model.id,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 40,
      completion_tokens: completionTokens,
      total_tokens: 40 + completionTokens,
    },
  });
  res.write('data: [DONE]\n\n');
  res.end();
});

app.listen(PORT, () => {
  console.log(`Mock provider: http://localhost:${PORT}/v1`);
  console.log(`API key: ${API_KEY}`);
  console.log(`Model: ${MODELS.map((model) => model.id).join(', ')}`);
});
