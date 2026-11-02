# FrontStellar Assess — AI Model Arena

Aplikasi web untuk menguji satu atau beberapa provider AI **OpenAI-compatible** dari satu tempat: validasi API key, ambil daftar model, lalu benchmark banyak model dengan prompt yang sama. Hasilnya dibandingkan lewat **TTFT**, **TPS**, **Latency E2E**, **diagram**, **statistik pengulangan**, dan kualitas jawaban.

![FrontStellar Assess](https://img.shields.io/badge/status-ready-c9ff5c) ![Node](https://img.shields.io/badge/node-%E2%89%A522-6fe3a0)

## Fitur

- **Multi-provider dalam satu pengujian** — tambahkan hingga 6 provider, masing-masing dengan Base URL, API key, dan pilihan model sendiri. Model dengan ID sama di provider berbeda tetap dibedakan.
- **Validasi API key** melalui endpoint `/models` provider, lengkap dengan status valid/tidak valid, latensi, dan jumlah model.
- **Normalisasi API key otomatis** — prefix `Bearer`, kutip, newline, dan karakter tak terlihat dibersihkan sebelum dikirim.
- **Verifikasi cadangan lewat chat** jika provider membatasi `/models` tetapi endpoint chat tetap berfungsi.
- **Fetch available models** dari endpoint OpenAI-compatible, termasuk context length dan owner.
- **Tambah model manual** jika provider tidak mengekspos daftar model.
- **Preset provider** (TipRouter, OpenAI, OpenRouter, Groq, Ollama) dan **preset prompt** siap pakai.
- **Benchmark hingga 100 model** (total lintas provider) dengan prompt, system prompt, temperature, dan max token yang sama.
- **Atur jumlah model bersamaan (1–20)** — nilai 1 berarti satu per satu, lebih tinggi berarti lebih cepat tetapi berisiko kena rate limit.
- **Auto-retry 429/503 + exponential backoff** — menghormati header `Retry-After`, memakai jitter, dan dapat dibatalkan. Jumlah retry ditampilkan per model.
- **Ulangi model yang gagal secara manual** — tombol per kartu/tabel atau sekaligus untuk semua model gagal, tanpa menjalankan ulang model yang sudah berhasil. Progres, ringkasan, dan riwayat ikut diperbarui.
- **Ulangi pengujian 1–10× + statistik** — min, median, rata-rata, maks, dan stdev untuk latency E2E, durasi generasi, TTFT, dan TPS.
- **Latency E2E (End-to-End)** — diukur dari prompt dikirim hingga seluruh jawaban selesai, lengkap dengan rincian TTFT + durasi generasi.
- **Diagram hasil yang interaktif** — bar chart horizontal untuk E2E/TPS/TTFT dan peta sebar TTFT vs TPS (SVG, tanpa library chart tambahan). Arahkan kursor untuk melihat tooltip metrik lengkap, klik batang/titik untuk menyorot model (tabel dan kartu ikut tersorot), serta klik legenda provider untuk menyaring diagram.
- **Urutkan model berdasarkan parameter uji** — E2E, TTFT, TPS, jumlah token, provider, atau nama model; klik lagi untuk membalik arah. Urutan berlaku untuk tabel perbandingan dan kartu jawaban, dan header tabel juga bisa diklik.
- **Streaming jawaban real-time** per model saat benchmark berjalan.
- **Pemenang otomatis** untuk latency E2E tercepat, TPS tertinggi, dan TTFT tercepat.
- **Tabel metrik dan perbandingan jawaban side-by-side**.
- **Provider tersimpan** — konfigurasi provider (label, Base URL, model, dan model terpilih) otomatis dipulihkan setelah reload, termasuk tab provider yang terakhir aktif. Tombol **Simpan provider** menyimpan profil terpisah (maks. 12) agar bisa dipakai ulang, dipindah ke tab kosong, atau ditambahkan sebagai tab baru. API key tidak pernah ikut disimpan dan harus diisi ulang.
- **Riwayat lokal** — benchmark selesai otomatis tersimpan di browser (maks. 15 entri), dapat dibuka lagi, dihapus, serta diekspor ke CSV/JSON. API key tidak pernah ikut disimpan.
- **Ekspor CSV dan JSON** untuk analisis lanjutan.
- **Mock provider lokal** untuk mencoba aplikasi tanpa biaya API, termasuk model `mock-flaky` untuk menguji retry 429.
- **Live Arena** — jalur balapan per model saat benchmark berjalan, ticker rekor TTFT/E2E/TPS, angka metrik yang beranimasi, serta podium tiga model tercepat dengan confetti halus saat selesai.
- **Compare & Explore** — pin hingga tiga model, jadikan salah satunya baseline, lihat delta persen per metrik, distribusi min–median–maks pengulangan, toggle skala log, brush-zoom pada peta sebar, dan modal spotlight berisi jawaban + statistik lengkap.
- **Power UX** — command palette `Ctrl/Cmd + K`, shortcut `R`/`S`/`1–6`/`?`, mode demo satu klik, dan toast **Urungkan** untuk penghapusan riwayat/provider.
- **Share & Delight** — ekspor kartu ringkasan PNG, tema terang/gelap, tiga warna aksen (lime/cyan/amber), diff dua riwayat, serta dukungan reduced motion.

## Menjalankan

Prasyarat: Node.js 22+ dan npm.

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`.

Server API berjalan di `http://localhost:8787` dan Vite mem-proxy `/api` ke sana.

### Build produksi

```bash
npm run build
npm start
```

Buka `http://localhost:8787`. Frontend hasil build akan disajikan langsung oleh server Express. Port API bisa diubah dengan environment variable `PORT`.

### GitHub Pages (demo statis)

GitHub Pages hanya menyajikan file statis, jadi **backend Express tidak ikut berjalan**. Di sana aplikasi memakai **mode demo statis**: jawaban dan metrik disimulasikan sepenuhnya di browser, tanpa API key dan tanpa request keluar. Benchmark provider nyata tetap memerlukan server lokal (`npm start`).

Workflow `.github/workflows/deploy-pages.yml` otomatis:

1. menjalankan `npm ci` dan `npm run build`;
2. mem-build dengan `VITE_STATIC_DEMO=true` dan base path `/<nama-repo>/`;
3. mengunggah `dist` lalu men-deploy ke GitHub Pages.

Aktifkan sekali di repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Setelah itu setiap push ke `main` akan men-deploy ulang.

Untuk mencoba build statis secara lokal:

```bash
# Windows PowerShell
$env:VITE_STATIC_DEMO="true"; $env:VITE_BASE_PATH="/FrontStellar-Assess/"; npm run build; npm run preview
```

### Mock provider (opsional)

Di terminal terpisah:

```bash
npm run mock
```

Lalu isi di aplikasi:

- **Base URL:** `http://localhost:4010/v1`
- **API key:** `demo-key`
- Tersedia 6 model: `mock-sprint`, `mock-turbo`, `mock-mini`, `mock-reasoner`, `mock-flaky`, dan `mock-fail-once`.

Model `mock-flaky` mengembalikan HTTP 429 (dengan `Retry-After: 1`) pada permintaan pertamanya. Setelah itu berhasil, sehingga Anda dapat melihat mekanisme retry bekerja. Model `mock-fail-once` mengembalikan HTTP 500 satu kali, lalu berhasil pada permintaan berikutnya — berguna untuk menguji tombol **Ulangi model ini**.

### Mode demo bawaan (tanpa proses terpisah)

Server produksi menyediakan endpoint demo OpenAI-compatible di `/demo/v1`, jadi Anda tidak perlu menjalankan mock provider terpisah. Klik **Coba mode demo** di hero (atau buka command palette lalu pilih *Muat & jalankan mode demo*). Aplikasi akan memasang provider **Demo lokal** dengan konfigurasi:

- **Base URL:** `http://localhost:8787/demo/v1` (mengikuti origin aplikasi)
- **API key:** `demo-key` (hanya di memori sesi)
- Model: `demo-sprint`, `demo-turbo`, `demo-mini`, `demo-reasoner`

Demo menghasilkan stream sungguhan dari server lokal sehingga TTFT, TPS, dan latency E2E tetap terukur, tetapi tidak ada biaya API dan tidak ada data yang dikirim ke pihak ketiga. Saat aplikasi di-deploy ke GitHub Pages, tombol yang sama memuat **Demo statis** yang berjalan di browser (lihat bagian GitHub Pages).

## Cara pakai

1. Masukkan **API Base URL** provider, misalnya:
   - TipRouter: `https://tiprouter.my.id/v1`
   - OpenAI: `https://api.openai.com/v1`
   - OpenRouter: `https://openrouter.ai/api/v1`
   - Groq: `https://api.groq.com/openai/v1`
   - Ollama: `http://localhost:11434/v1`
2. Masukkan **API key**. Untuk provider lokal yang tidak memakai auth, biarkan kosong. Key boleh ditempel apa adanya, termasuk `Bearer tip_...` atau dalam tanda kutip.
3. Klik **Uji API key** untuk memastikan kredensial diterima.
4. Jika provider menolak `/models` tetapi key Anda valid di aplikasi lain, gunakan **Verifikasi lewat chat**: isi ID model yang tersedia (mis. `deepseek-v-4.1-flash` untuk TipRouter), lalu klik **Uji via chat**.
5. Klik **Muat model**, lalu pilih model yang ingin diadu. Model yang diverifikasi lewat chat otomatis ditambahkan ke daftar.
6. Untuk provider lain, klik **Tambah provider**, isi kredensialnya, lalu verifikasi dan muat modelnya. Tab provider menunjukkan status terverifikasi.
7. Tulis prompt (atau pilih preset seperti *Ibu kota*, *Hitung*, *Perkenalan*, *Gynoid*, *Sapaan*, *Riset medis*, *Refleksi*), atur temperature/max token.
8. Atur **Model bersamaan** (1 = satu per satu) dan **Ulangi pengujian** bila ingin statistik.
9. Klik **Jalankan benchmark**. Maksimal 100 model per pengujian. Selama berjalan, **Live Arena** menampilkan jalur balapan dan rekor metrik.
10. Lihat pemenang, diagram, tabel metrik, statistik per model, dan bandingkan jawaban. Pin hingga tiga model untuk mode banding, atau klik **Fokus** untuk membuka jawaban + statistik penuh.
11. Ekspor ke CSV/JSON/PNG, ganti tema atau aksen, dan buka kembali riwayat. Pilih dua riwayat untuk melihat diff metrik per model.

## Shortcut & command palette

| Tombol | Aksi |
| --- | --- |
| `Ctrl/Cmd + K` | Buka command palette (jalankan benchmark, ulangi gagal, ganti tema, ekspor, pindah provider) |
| `R` | Jalankan benchmark |
| `S` | Hentikan benchmark yang berjalan |
| `1`–`6` | Pindah tab provider |
| `?` | Buka daftar shortcut |
| `Esc` | Tutup dialog/palette |

Shortcut huruf dan angka tidak aktif saat fokus berada di kolom input, textarea, atau select.

## Definisi metrik

| Metrik | Definisi |
| --- | --- |
| **Latency E2E** | Waktu penuh dari prompt dikirim hingga seluruh jawaban selesai di-stream. Mencakup TTFT, generasi, dan jeda retry, tetapi **tidak** mencakup waktu menunggu antrean saat model lain berjalan. |
| **Generasi** | Durasi dari token pertama diterima hingga stream selesai (`E2E − TTFT` per sampel). |
| **TTFT** | Waktu dari request dikirim hingga token pertama (konten atau reasoning) diterima. |
| **TPS** | `completion_tokens / durasi generasi` (dihitung setelah token pertama). Bila provider mengirim `usage`, angka token diambil dari sana; jika tidak, token diperkirakan dengan tokenizer dan ditandai `≈`. |
| **Statistik** | Saat pengulangan > 1, nilai utama adalah **median**; min/mean/max/stdev dihitung dari semua sampel yang berhasil. |

Pemenang dihitung hanya dari model yang berhasil menyelesaikan pengujian. TPS bisa berbeda antar-provider karena cara provider memecah chunk, jaringan, dan apakah `usage` tersedia. Gunakan prompt yang cukup panjang (mis. 100+ token output) agar pengukuran TPS lebih stabil.

## Retry dan concurrency

- Permintaan chat diulang otomatis hingga 4 kali untuk HTTP **429** dan **503**, serta gangguan koneksi sementara.
- Jeda memakai header `Retry-After` bila tersedia; jika tidak, exponential backoff 800 ms → 1,6 s → 3,2 s → 6,4 s dengan jitter.
- Retry dapat dibatalkan saat pengujian dihentikan.
- **Model bersamaan** membatasi jumlah job aktif secara global lintas provider. Job yang menunggu tetap berstatus antrean.
- Setiap model dalam satu job menjalankan pengulangannya secara berurutan agar sampel tidak saling mengganggu.

## API internal

Server lokal menyediakan empat endpoint API dan satu router demo:

- `POST /api/validate` — `{ baseUrl, apiKey }`
- `POST /api/validate-chat` — `{ baseUrl, apiKey, model }` untuk verifikasi cadangan lewat chat
- `POST /api/models` — `{ baseUrl, apiKey }`
- `POST /api/benchmark` — menerima:
  ```json
  {
    "providers": [
      { "id": "p1", "label": "Provider 1", "baseUrl": "...", "resolvedBaseUrl": "...", "apiKey": "...", "models": ["model-a"] }
    ],
    "prompt": "...",
    "systemPrompt": "",
    "temperature": 0.7,
    "maxTokens": 512,
    "concurrency": 4,
    "repetitions": 1
  }
  ```
  Total model lintas provider maksimal 100. Format lama `{ baseUrl, apiKey, models }` tetap diterima. Respons berupa **NDJSON stream** dengan event:
  `start`, `model_start`, `sample_start`, `first_token`, `delta`, `retry`, `sample_done`, `done`, `model_error`, `progress`, `complete`.

  Setiap `result` pada event `sample_done`/`done` memuat `e2eMs` (latency E2E), `generationMs`, `ttftMs`, `tps`, dan `totalMs` (alias `e2eMs` untuk kompatibilitas). Statistik `done.stats` menyediakan `e2eMs`, `generationMs`, `ttftMs`, `tps`, dan `completionTokens` dalam bentuk min/median/mean/maks/stdev.

- `GET /demo/v1/models` dan `POST /demo/v1/chat/completions` — provider demo bawaan. Memerlukan header `Authorization: Bearer demo-key` dan mengembalikan stream SSE seperti provider OpenAI-compatible.
- `GET /api/health` — status server, versi aplikasi, dan penanda `demo: true`.

API key hanya diteruskan dari browser ke server lokal, lalu ke provider. Key tidak ditulis ke `localStorage`, tidak masuk log aplikasi, dan tidak disimpan di server. Yang dipulihkan dari `localStorage` hanya konfigurasi provider tanpa kredensial (`frontstellar.providers.current`, `frontstellar.providers.active`, `frontstellar.savedProviders`) — API key harus diisi ulang setelah reload. Pesan error dari provider disanitasi sebelum dikirim balik ke browser.

## Struktur proyek

```
index.html          Entry Vite
vite.config.ts      Konfigurasi Vite + proxy /api ke server lokal
tsconfig.json       Konfigurasi TypeScript
public/
  favicon.svg
server/
  index.js          Express API, static hosting, pool concurrency, NDJSON stream
  provider.js       Resolusi URL, validasi, streaming, retry/backoff, agregasi statistik
  demo.js           Provider demo bawaan (stream SSE lokal)
src/
  App.tsx           UI utama, state multi-provider/model/benchmark, command palette
  api.ts            Client API dan parser NDJSON
  history.ts        Riwayat lokal (localStorage, tanpa API key)
  providerStorage.ts Provider aktif/tersimpan (localStorage, tanpa API key)
  preferences.ts    Tema, aksen, dan reduced motion
  exportImage.ts    Ekspor kartu ringkasan PNG
  components/
    ResultCard.tsx    Kartu hasil + statistik + distribusi pengulangan
    ResultsPanel.tsx  Pemenang, diagram, tabel, jawaban, pin/compare
    MetricCharts.tsx  Bar chart (skala log) dan peta sebar TTFT vs TPS (brush zoom)
    LiveArena.tsx     Jalur balapan, ticker rekor, dan podium
    SpotlightModal.tsx Modal jawaban + statistik
    CompareDrawer.tsx Perbandingan model yang dipin
    CommandPalette.tsx Command palette Ctrl/Cmd + K
    ShortcutsHelp.tsx  Bantuan shortcut keyboard
    HistoryPanel.tsx  Daftar riwayat, seleksi, dan diff
    HistoryDiff.tsx   Perbandingan dua entri riwayat
  format.ts         Format angka, CSV/JSON, clipboard
scripts/
  mock-provider.js  Provider OpenAI-compatible untuk demo lokal
```

## Catatan keamanan

Aplikasi ini dirancang untuk dijalankan secara lokal dan server hanya listen pada `127.0.0.1` secara default. Karena Base URL dapat diisi bebas, server akan melakukan request ke URL tersebut (termasuk localhost/LAN). Jangan mengekspos server ini ke internet publik tanpa menambahkan autentikasi, allowlist URL, dan rate limiting. Untuk mengakses dari perangkat lain di jaringan lokal, set `HOST=0.0.0.0` secara sadar.
