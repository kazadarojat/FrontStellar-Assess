import express from 'express';

const API_KEY = 'demo-key';

const MODELS = [
  { id: 'demo-sprint', name: 'Demo Sprint', ttft: 60, tps: 42, words: 62, reasoning: false },
  { id: 'demo-turbo', name: 'Demo Turbo', ttft: 150, tps: 64, words: 78, reasoning: false },
  { id: 'demo-mini', name: 'Demo Mini', ttft: 40, tps: 16, words: 46, reasoning: false },
  { id: 'demo-reasoner', name: 'Demo Reasoner', ttft: 320, tps: 24, words: 68, reasoning: true },
];

function authorized(req) {
  return req.headers.authorization === `Bearer ${API_KEY}`;
}

function answerFor(model, prompt) {
  const topic = String(prompt || '').slice(0, 90).replace(/\s+/g, ' ');
  const prefix =
    model.id === 'demo-reasoner'
      ? 'Saya menimbang dua hal utama: waktu tunggu awal dan kecepatan produksi token. '
      : '';
  return `${prefix}**${model.name}** menjawab prompt tentang “${topic}”.

Ini adalah **mode demo bawaan FrontStellar Assess**. Jawaban dihasilkan oleh mock lokal di server, jadi tidak ada biaya API dan tidak ada data yang dikirim ke pihak ketiga.

- TTFT mengukur seberapa cepat token pertama muncul.
- TPS mengukur kecepatan token setelah token pertama.
- Latency E2E mengukur waktu penuh sampai jawaban selesai.

Gunakan tombol **Jalankan benchmark** untuk melihat grafik, podium, dan statistik. Semua angka berasal dari simulasi lokal dan hanya untuk mencoba antarmuka.`;
}

export function createDemoRouter() {
  const router = express.Router();

  router.get('/models', (req, res) => {
    if (!authorized(req)) {
      return res.status(401).json({ error: { message: 'API key demo tidak valid.' } });
    }
    return res.json({
      object: 'list',
      data: MODELS.map((model, index) => ({
        id: model.id,
        object: 'model',
        created: 1_735_000_000 + index,
        owned_by: 'frontstellar-demo',
        context_length: 64_000,
      })),
    });
  });

  router.post('/chat/completions', async (req, res) => {
    if (!authorized(req)) {
      return res.status(401).json({ error: { message: 'API key demo tidak valid.' } });
    }

    const model = MODELS.find((item) => item.id === req.body?.model);
    if (!model) {
      return res.status(404).json({ error: { message: `Model demo ${req.body?.model} tidak ditemukan.` } });
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
    const delay = Math.max(10, Math.round(1000 / model.tps));

    send({
      id: 'chatcmpl-demo',
      object: 'chat.completion.chunk',
      model: model.id,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    });

    await wait(model.ttft);

    if (model.reasoning) {
      const reasoningText =
        'Membaca prompt. Memilih struktur jawaban singkat. Menyiapkan metrik yang relevan.';
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
        id: 'chatcmpl-demo',
        object: 'chat.completion.chunk',
        model: model.id,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      });
      await wait(delay);
    }

    send({
      id: 'chatcmpl-demo',
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

  return router;
}
