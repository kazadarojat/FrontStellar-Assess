import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Command,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Gauge,
  History,
  Image as ImageIcon,
  Info,
  KeyRound,
  Keyboard,
  Layers,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  Moon,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Timer,
  Trash2,
  Undo2,
  WandSparkles,
  Zap,
} from 'lucide-react';
import {
  ApiError,
  fetchAvailableModels,
  streamBenchmark,
  validateProvider,
  validateProviderWithChat,
} from './api';
import {
  downloadCsv,
  downloadJson,
  formatContext,
  formatLatency,
  timestampSlug,
} from './format';
import type {
  BenchmarkEvent,
  BenchmarkRun,
  ModelInfo,
  Phase,
  ValidationResult,
} from './types';
import ResultsPanel from './components/ResultsPanel';
import HistoryPanel from './components/HistoryPanel';
import CommandPalette, { type PaletteAction } from './components/CommandPalette';
import ShortcutsHelp from './components/ShortcutsHelp';
import type { HistoryEntry } from './history';
import {
  addHistory,
  clearHistory,
  loadHistory,
  removeHistory,
  replaceHistory,
} from './history';
import { downloadSummaryPng } from './exportImage';
import {
  accentColor,
  applyPreferences,
  loadPreferences,
  nextAccent,
  savePreferences,
  type Preferences,
} from './preferences';
import {
  loadCurrentProviders,
  loadActiveProviderIndex,
  loadSavedProviders,
  saveCurrentProviders,
  saveSavedProviders,
  MAX_SAVED_PROVIDERS,
  type SavedProvider,
  type StoredProvider,
} from './providerStorage';

const MAX_MODELS = 100;
const MAX_PROVIDERS = 6;
const MAX_CONCURRENCY = 20;
const MAX_REPETITIONS = 10;

const DEFAULT_PROMPT =
  'Bandingkan latensi dan throughput pada sistem AI. Jelaskan dengan bahasa sederhana, berikan satu analogi, lalu sebutkan metrik yang paling penting untuk aplikasi chatbot real-time. Jawab dalam bahasa Indonesia, maksimal 140 kata.';

const PROMPT_PRESETS = [
  { label: 'Ibu kota', text: 'Sebutkan nama ibu kota Indonesia' },
  { label: 'Hitung', text: 'Berapa hasil dari 15 dikali 8?' },
  { label: 'Perkenalan', text: 'Kenalkan Siapa Kamu dalam 1 kalimat' },
  { label: 'Gynoid', text: 'Jelaskan Apa itu Gynoid dalam 1 Kalimat' },
  { label: 'Sapaan', text: 'Cukup Jawab hanya : Hai Aku disini' },
  { label: 'Riset medis', text: 'Berikan 1 ide penelitian Medis singkat dalam 1 kalimat' },
  {
    label: 'Refleksi',
    text: 'Jelaskan Keunggulanmu dan kekuranganmu secara singkat dalam 1 kalimat.',
  },
  { label: 'Analisis', text: DEFAULT_PROMPT },
  {
    label: 'Kode',
    text: 'Buat fungsi TypeScript bernama chunkArray yang membagi array menjadi beberapa bagian dengan ukuran tertentu. Sertakan tipe generik, validasi input, contoh penggunaan, dan penjelasan singkat kompleksitas waktunya.',
  },
];

const PROVIDER_PRESETS: Array<{ label: string; url: string; model?: string }> = [
  { label: 'TipRouter', url: 'https://tiprouter.my.id/v1', model: 'deepseek-v-4.1-flash' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { label: 'Ollama lokal', url: 'http://localhost:11434/v1' },
];

const TIPROUTER_CHAT_MODEL = 'deepseek-v-4.1-flash';

const DEMO_MODELS: ModelInfo[] = [
  { id: 'demo-sprint', name: 'Demo Sprint', ownedBy: 'frontstellar-demo', contextLength: 64_000 },
  { id: 'demo-turbo', name: 'Demo Turbo', ownedBy: 'frontstellar-demo', contextLength: 64_000 },
  { id: 'demo-mini', name: 'Demo Mini', ownedBy: 'frontstellar-demo', contextLength: 64_000 },
  {
    id: 'demo-reasoner',
    name: 'Demo Reasoner',
    ownedBy: 'frontstellar-demo',
    contextLength: 64_000,
  },
];

function demoBaseUrl(): string {
  return `${window.location.origin}/demo/v1`;
}

interface UndoState {
  message: string;
  restore: () => void;
}

interface ProviderProfile {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  showKey: boolean;
  validation: ValidationResult | null;
  connectError: string | null;
  validating: boolean;
  verified: boolean;
  resolvedBaseUrl: string;
  chatModel: string;
  chatValidating: boolean;
  chatError: string | null;
  models: ModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
  selected: string[];
}

interface RunSettings {
  prompt: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  concurrency: number;
  repetitions: number;
}

interface RunJob {
  key: string;
  providerId: string;
  providerLabel: string;
  providerHost: string;
  model: string;
}

function isTipRouterHost(raw: string): boolean {
  const host = hostFromUrl(raw).toLowerCase();
  return host === 'tiprouter.my.id' || host.endsWith('.tiprouter.my.id');
}

function readLocal(keys: string | string[], fallback: string): string {
  const list = Array.isArray(keys) ? keys : [keys];
  try {
    for (const key of list) {
      const value = window.localStorage.getItem(key);
      if (value != null && value !== '') return value;
    }
  } catch {
    // Local storage can be unavailable in private browsing modes.
  }
  return fallback;
}

function hostFromUrl(raw: string): string {
  try {
    const normalized = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(normalized).host;
  } catch {
    return raw;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terjadi kesalahan yang tidak diketahui.';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function createProvider(index: number, baseUrl = ''): ProviderProfile {
  return {
    id: `prov-${Math.random().toString(36).slice(2, 10)}`,
    label: `Provider ${index + 1}`,
    baseUrl,
    apiKey: '',
    showKey: false,
    validation: null,
    connectError: null,
    validating: false,
    verified: false,
    resolvedBaseUrl: '',
    chatModel: isTipRouterHost(baseUrl) ? TIPROUTER_CHAT_MODEL : '',
    chatValidating: false,
    chatError: null,
    models: [],
    modelsLoading: false,
    modelsError: null,
    selected: [],
  };
}

function hydrateProvider(entry: StoredProvider, index: number): ProviderProfile {
  const base = createProvider(index, entry.baseUrl);
  return {
    ...base,
    label: entry.label || `Provider ${index + 1}`,
    chatModel: entry.chatModel || base.chatModel,
    models: entry.models,
    selected: entry.selected,
  };
}

function initialProviders(): ProviderProfile[] {
  const stored = loadCurrentProviders();
  if (stored.length) {
    return stored.slice(0, MAX_PROVIDERS).map((entry, index) => hydrateProvider(entry, index));
  }
  const legacy = readLocal(['frontstellar.baseUrl', 'modelbench.baseUrl'], '');
  return [createProvider(0, legacy)];
}

function modelKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

function emptyRun(job: RunJob): BenchmarkRun {
  return {
    ...job,
    status: 'queued',
    content: '',
    reasoning: '',
    ttftMs: null,
    elapsedMs: null,
    result: null,
    error: null,
    samples: [],
    stats: null,
    retries: 0,
    failedSamples: 0,
    repetition: 0,
    sampleTotal: 1,
  };
}

function buildResultRows(runs: BenchmarkRun[], prompt: string): Array<Array<string | number | null>> {
  const header = [
    'Provider',
    'Host',
    'Model',
    'Status',
    'Prompt',
    'Pengulangan',
    'Retry',
    'TTFT median (ms)',
    'TTFT min (ms)',
    'TTFT maks (ms)',
    'TTFT stdev (ms)',
    'TPS median',
    'TPS stdev',
    'Latency E2E median (ms)',
    'E2E min (ms)',
    'E2E maks (ms)',
    'E2E stdev (ms)',
    'Generasi median (ms)',
    'Generasi stdev (ms)',
    'Token output',
    'Jawaban',
    'Error',
  ];

  return [
    header,
    ...runs.map((run) => [
      run.providerLabel,
      run.providerHost,
      run.model,
      run.status === 'done' ? 'selesai' : 'gagal',
      prompt,
      run.samples.length || run.stats?.e2eMs?.count || run.stats?.totalMs.count || 0,
      run.retries,
      run.result?.ttftMs ?? null,
      run.stats?.ttftMs.min ?? null,
      run.stats?.ttftMs.max ?? null,
      run.stats?.ttftMs.stdev ?? null,
      run.result?.tps ?? null,
      run.stats?.tps.stdev ?? null,
      run.result?.e2eMs ?? run.result?.totalMs ?? null,
      (run.stats?.e2eMs ?? run.stats?.totalMs)?.min ?? null,
      (run.stats?.e2eMs ?? run.stats?.totalMs)?.max ?? null,
      (run.stats?.e2eMs ?? run.stats?.totalMs)?.stdev ?? null,
      run.stats?.generationMs?.median ?? null,
      run.stats?.generationMs?.stdev ?? null,
      run.result?.completionTokens ?? null,
      run.content || run.reasoning || '',
      run.error?.message ?? '',
    ]),
  ];
}

function buildExportPayload(
  settings: RunSettings,
  runs: BenchmarkRun[],
  wallTotalMs: number | null,
  createdAt: string,
) {
  return {
    app: 'FrontStellar Assess',
    exportedAt: new Date().toISOString(),
    createdAt,
    prompt: settings.prompt,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    concurrency: settings.concurrency,
    repetitions: settings.repetitions,
    wallTotalMs,
    metricDefinitions: {
      latencyE2e:
        'Waktu dari prompt dikirim hingga seluruh jawaban selesai di-stream (termasuk retry, tanpa waktu antrean).',
      generationMs: 'Dari token pertama diterima hingga stream selesai (E2E − TTFT).',
      ttftMs: 'Waktu dari prompt dikirim hingga token pertama diterima.',
      tps: 'Token output per detik setelah token pertama.',
    },
    results: runs.map((run) => ({
      provider: {
        id: run.providerId,
        label: run.providerLabel,
        host: run.providerHost,
      },
      model: run.model,
      status: run.status,
      retries: run.retries,
      failedSamples: run.failedSamples,
      metrics: run.result,
      stats: run.stats,
      answer: run.content,
      reasoning: run.reasoning,
      samples: run.samples,
      error: run.error,
    })),
  };
}

export default function App() {
  const [providers, setProviders] = useState<ProviderProfile[]>(initialProviders);
  const [activeId, setActiveId] = useState(() => {
    const index = loadActiveProviderIndex();
    const provider = providers[Math.min(Math.max(index, 0), providers.length - 1)];
    return provider?.id ?? '';
  });
  const [search, setSearch] = useState('');
  const [manualModel, setManualModel] = useState('');

  const [prompt, setPrompt] = useState(() =>
    readLocal(['frontstellar.prompt', 'modelbench.prompt'], DEFAULT_PROMPT),
  );
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [concurrency, setConcurrency] = useState(() =>
    clampNumber(
      Number(readLocal(['frontstellar.concurrency', 'modelbench.concurrency'], '4')) || 4,
      1,
      MAX_CONCURRENCY,
    ),
  );
  const [repetitions, setRepetitions] = useState(() =>
    clampNumber(
      Number(readLocal(['frontstellar.repetitions', 'modelbench.repetitions'], '1')) || 1,
      1,
      MAX_REPETITIONS,
    ),
  );

  const [phase, setPhase] = useState<Phase>('idle');
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [benchTotal, setBenchTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [wallTotalMs, setWallTotalMs] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [wasStopped, setWasStopped] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [runSettings, setRunSettings] = useState<RunSettings>({
    prompt: DEFAULT_PROMPT,
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 512,
    concurrency: 4,
    repetitions: 1,
  });
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [savedProviders, setSavedProviders] = useState<SavedProvider[]>(loadSavedProviders);
  const [notice, setNotice] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const savedRunRef = useRef<string | null>(null);
  const demoRunRef = useRef(false);
  // Konteks pengulangan model gagal agar progres & total tetap mencerminkan seluruh hasil.
  const retryRef = useRef<{
    total: number;
    previousDone: number;
    previousRetries: number;
  } | null>(null);

  const activeProvider = providers.find((provider) => provider.id === activeId) ?? providers[0];

  const selectedCount = providers.reduce((sum, provider) => sum + provider.selected.length, 0);
  const verifiedProviders = providers.filter((provider) => provider.verified);
  const runnableProviders = verifiedProviders.filter(
    (provider) => provider.selected.length > 0 && provider.resolvedBaseUrl,
  );
  const runnableCount = runnableProviders.reduce(
    (sum, provider) => sum + provider.selected.length,
    0,
  );
  const totalModelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const busy =
    phase === 'running' ||
    providers.some(
      (provider) =>
        provider.validating || provider.modelsLoading || provider.chatValidating,
    );

  const query = search.trim().toLowerCase();
  const matchModel = (model: ModelInfo) => {
    if (!query) return true;
    return (
      model.id.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query) ||
      Boolean(model.ownedBy?.toLowerCase().includes(query))
    );
  };
  const visibleEntries = providers.flatMap((provider) =>
    provider.models
      .filter(matchModel)
      .map((model) => ({ provider, model, key: modelKey(provider.id, model.id) })),
  );

  const canRun = runnableCount > 0 && prompt.trim().length > 0 && phase !== 'running';

  let runHint = '';
  if (!verifiedProviders.length) {
    runHint = 'Verifikasi API key minimal satu provider terlebih dahulu.';
  } else if (!selectedCount) {
    runHint = 'Pilih minimal satu model untuk diuji.';
  } else if (!prompt.trim()) {
    runHint = 'Tulis prompt yang akan dikirim ke semua model.';
  } else if (!runnableCount) {
    runHint =
      'Model terpilih berada di provider yang belum terverifikasi. Verifikasi provider tersebut atau pilih model lain.';
  } else {
    const parts = [
      `${runnableCount} model`,
      `${runnableProviders.length} provider`,
      concurrency <= 1 ? 'satu per satu' : `${concurrency} bersamaan`,
    ];
    if (repetitions > 1) parts.push(`${repetitions}× ulangan`);
    const skipped = selectedCount - runnableCount;
    runHint =
      `${parts.join(' · ')} dengan prompt yang sama.` +
      (skipped > 0
        ? ` ${skipped} model dari provider belum terverifikasi akan dilewati.`
        : '');
  }

  const showChatFallback =
    Boolean(activeProvider) &&
    !activeProvider.validating &&
    !activeProvider.verified &&
    Boolean(activeProvider.baseUrl.trim()) &&
    (Boolean(activeProvider.validation && !activeProvider.validation.valid) ||
      Boolean(activeProvider.modelsError));

  const activeStatusTone = activeProvider?.validation?.valid
    ? 'success'
    : activeProvider?.validation && activeProvider.validation.keyStatus === 'invalid'
      ? 'error'
      : activeProvider?.validation
        ? 'warning'
        : 'neutral';

  useEffect(() => {
    saveCurrentProviders(
      providers.map((provider) => ({
        label: provider.label,
        baseUrl: provider.baseUrl,
        chatModel: provider.chatModel,
        models: provider.models.filter((model) => provider.selected.includes(model.id)),
        selected: provider.selected,
      })),
      Math.max(0, providers.findIndex((provider) => provider.id === activeId)),
    );
  }, [providers, activeId]);

  useEffect(() => {
    saveSavedProviders(savedProviders);
  }, [savedProviders]);

  useEffect(() => {
    try {
      window.localStorage.setItem('frontstellar.prompt', prompt);
    } catch {
      // Ignore storage failures.
    }
  }, [prompt]);

  useEffect(() => {
    try {
      window.localStorage.setItem('frontstellar.concurrency', String(concurrency));
    } catch {
      // Ignore storage failures.
    }
  }, [concurrency]);

  useEffect(() => {
    try {
      window.localStorage.setItem('frontstellar.repetitions', String(repetitions));
    } catch {
      // Ignore storage failures.
    }
  }, [repetitions]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3_400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    applyPreferences(preferences);
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!undo) return;
    const timeout = window.setTimeout(() => setUndo(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [undo]);

  // Satu klik demo: pasang provider demo, lalu jalankan otomatis setelah state siap.
  useEffect(() => {
    if (!demoRunRef.current) return;
    if (phase === 'running') return;
    if (!canRun) return;
    demoRunRef.current = false;
    const timeout = window.setTimeout(() => void handleRun(), 60);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, prompt, phase, canRun]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        return;
      }
      if (modifier || event.altKey || isTypingTarget(event.target)) return;

      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        if (canRun) {
          event.preventDefault();
          void handleRun();
        }
        return;
      }
      if (event.key.toLowerCase() === 's') {
        if (phase === 'running') {
          event.preventDefault();
          handleStop();
        }
        return;
      }
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= providers.length) {
        event.preventDefault();
        setActiveId(providers[index - 1].id);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun, phase, providers]);

  useEffect(() => {
    return () => {
      runAbortRef.current?.abort();
      requestAbortRef.current?.abort();
    };
  }, []);

  // Simpan hasil ke riwayat setelah pengujian selesai (termasuk saat dihentikan).
  useEffect(() => {
    if (phase !== 'finished' || !runIdRef.current || !runs.length) return;
    if (savedRunRef.current === runIdRef.current) return;
    const id = runIdRef.current;
    savedRunRef.current = id;
    const entry: HistoryEntry = {
      id,
      createdAt: new Date().toISOString(),
      prompt: runSettings.prompt,
      systemPrompt: runSettings.systemPrompt,
      temperature: runSettings.temperature,
      maxTokens: runSettings.maxTokens,
      concurrency: runSettings.concurrency,
      repetitions: runSettings.repetitions,
      wallTotalMs,
      retries: runs.reduce((sum, run) => sum + run.retries, 0),
      runs,
    };
    setHistory(addHistory(entry));
  }, [phase, runs, wallTotalMs, runSettings]);

  function patchProvider(id: string, patch: Partial<ProviderProfile>) {
    setProviders((previous) =>
      previous.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)),
    );
  }

  function addProvider() {
    if (providers.length >= MAX_PROVIDERS) {
      setNotice(`Maksimal ${MAX_PROVIDERS} provider per sesi.`);
      return;
    }
    const nextNumber =
      providers.reduce((max, provider) => {
        const match = provider.label.match(/\d+/);
        return Math.max(max, match ? Number(match[0]) : 0);
      }, 0) + 1;
    const provider = createProvider(nextNumber - 1);
    setProviders((previous) => [...previous, provider]);
    setActiveId(provider.id);
  }

  function removeProvider(id: string) {
    if (providers.length <= 1 || phase === 'running') return;
    const remaining = providers.filter((provider) => provider.id !== id);
    setProviders(remaining);
    if (activeProvider?.id === id) setActiveId(remaining[0]?.id ?? '');
  }

  function handleSaveProvider() {
    if (!activeProvider) return;
    if (!activeProvider.baseUrl.trim()) {
      setNotice('Isi API Base URL sebelum menyimpan provider.');
      return;
    }
    if (phase === 'running') return;

    const host = hostFromUrl(activeProvider.resolvedBaseUrl || activeProvider.baseUrl);
    const entry: SavedProvider = {
      id: `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${activeProvider.label} · ${host}`,
      label: activeProvider.label,
      baseUrl: activeProvider.baseUrl,
      chatModel: activeProvider.chatModel,
      models: activeProvider.models.filter((model) => activeProvider.selected.includes(model.id)),
      selected: activeProvider.selected,
      savedAt: new Date().toISOString(),
    };

    const existing = savedProviders.find((saved) => saved.baseUrl === entry.baseUrl);
    if (!existing && savedProviders.length >= MAX_SAVED_PROVIDERS) {
      setNotice(`Maksimal ${MAX_SAVED_PROVIDERS} provider tersimpan. Hapus satu terlebih dahulu.`);
      return;
    }

    setSavedProviders((previous) => {
      if (existing) {
        return previous.map((saved) =>
          saved.id === existing.id
            ? { ...entry, id: existing.id, name: existing.name, savedAt: entry.savedAt }
            : saved,
        );
      }
      return [entry, ...previous];
    });
    setNotice('Provider disimpan tanpa API key dan siap dipakai lagi.');
  }

  function handleUseSavedProvider(savedId: string) {
    const saved = savedProviders.find((entry) => entry.id === savedId);
    if (!saved || phase === 'running') return;

    const alreadyOpen = providers.find((provider) => provider.baseUrl === saved.baseUrl);
    if (alreadyOpen) {
      setActiveId(alreadyOpen.id);
      setNotice('Provider ini sudah terbuka. Isi API key bila belum terverifikasi.');
      return;
    }

    const activeIndex = providers.findIndex((provider) => provider.id === activeProvider?.id);
    const activeIsEmpty =
      Boolean(activeProvider) &&
      !activeProvider.baseUrl.trim() &&
      !activeProvider.models.length &&
      !activeProvider.selected.length;

    if (activeIsEmpty && activeProvider) {
      const hydrated = { ...hydrateProvider(saved, activeIndex), id: activeProvider.id };
      setProviders((previous) =>
        previous.map((provider) => (provider.id === activeProvider.id ? hydrated : provider)),
      );
      setActiveId(activeProvider.id);
    } else {
      if (providers.length >= MAX_PROVIDERS) {
        setNotice(`Maksimal ${MAX_PROVIDERS} provider. Hapus salah satu sebelum memuat provider tersimpan.`);
        return;
      }
      const hydrated = hydrateProvider(saved, providers.length);
      const usedLabels = new Set(providers.map((provider) => provider.label));
      if (usedLabels.has(hydrated.label)) {
        let suffix = 2;
        while (usedLabels.has(`${hydrated.label} (${suffix})`)) suffix += 1;
        hydrated.label = `${hydrated.label} (${suffix})`;
      }
      setProviders((previous) => [...previous, hydrated]);
      setActiveId(hydrated.id);
    }

    setNotice(`Provider tersimpan dimuat. Isi API key lalu uji koneksi.`);
  }

  function handleDeleteSavedProvider(savedId: string) {
    setSavedProviders((previous) => previous.filter((entry) => entry.id !== savedId));
    setNotice('Provider tersimpan dihapus.');
  }

  function handleBaseUrlChange(value: string) {
    if (!activeProvider) return;
    const chatModel = isTipRouterHost(value)
      ? activeProvider.chatModel || TIPROUTER_CHAT_MODEL
      : activeProvider.chatModel === TIPROUTER_CHAT_MODEL
        ? ''
        : activeProvider.chatModel;
    patchProvider(activeProvider.id, {
      baseUrl: value,
      verified: false,
      validation: null,
      connectError: null,
      chatError: null,
      resolvedBaseUrl: '',
      models: [],
      selected: [],
      modelsError: null,
      chatModel,
    });
  }

  function handleApiKeyChange(value: string) {
    if (!activeProvider) return;
    patchProvider(activeProvider.id, {
      apiKey: value,
      verified: false,
      validation: null,
      connectError: null,
      resolvedBaseUrl: '',
    });
  }

  function applyProviderPreset(url: string, suggestedModel?: string) {
    if (!activeProvider || busy) return;
    const chatModel = suggestedModel ?? (isTipRouterHost(url) ? TIPROUTER_CHAT_MODEL : '');
    patchProvider(activeProvider.id, {
      baseUrl: url,
      chatModel,
      verified: false,
      validation: null,
      connectError: null,
      chatError: null,
      resolvedBaseUrl: '',
      models: [],
      selected: [],
      modelsError: null,
    });
  }

  async function handleValidate(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    if (!provider.baseUrl.trim()) {
      patchProvider(providerId, { connectError: 'Isi API Base URL terlebih dahulu.' });
      return;
    }

    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const isCurrent = () => requestAbortRef.current === controller;

    patchProvider(providerId, { validating: true, validation: null, connectError: null });

    try {
      const result = await validateProvider(provider.baseUrl, provider.apiKey, controller.signal);
      if (!isCurrent()) return;
      patchProvider(providerId, {
        validation: result,
        verified: result.valid,
        resolvedBaseUrl: result.valid ? result.baseUrl : '',
      });
      if (!result.valid) {
        patchProvider(providerId, { modelsError: null });
      }
      if (result.keyAdjusted) {
        setNotice('Prefix Bearer, kutip, atau karakter tak terlihat pada API key dibersihkan otomatis.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!isCurrent()) return;
      patchProvider(providerId, {
        connectError: errorMessage(error),
        verified: false,
        resolvedBaseUrl: '',
      });
    } finally {
      if (isCurrent()) patchProvider(providerId, { validating: false });
    }
  }

  async function handleLoadModels(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    if (!provider.baseUrl.trim()) {
      patchProvider(providerId, { connectError: 'Isi API Base URL terlebih dahulu.' });
      return;
    }

    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const isCurrent = () => requestAbortRef.current === controller;

    patchProvider(providerId, { modelsLoading: true, modelsError: null, connectError: null });

    try {
      const result = await fetchAvailableModels(provider.baseUrl, provider.apiKey, controller.signal);
      if (!isCurrent()) return;
      patchProvider(providerId, {
        models: result.models,
        resolvedBaseUrl: result.baseUrl,
        verified: true,
        validation: {
          ok: true,
          valid: true,
          keyStatus: 'valid',
          baseUrl: result.baseUrl,
          host: result.host,
          latencyMs: result.latencyMs,
          modelCount: result.models.length,
          message: `API key valid. ${result.models.length} model berhasil dimuat.`,
        },
        selected: provider.selected.filter((id) =>
          result.models.some((model) => model.id === id),
        ),
        modelsError:
          result.models.length === 0
            ? 'Provider tidak mengembalikan model. Tambahkan ID model secara manual.'
            : null,
      });
      if (result.keyAdjusted) {
        setNotice('Prefix Bearer, kutip, atau karakter tak terlihat pada API key dibersihkan otomatis.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!isCurrent()) return;
      const apiError = error instanceof ApiError ? error : null;
      const message = errorMessage(error);
      patchProvider(providerId, { modelsError: message });
      if (apiError?.status === 401 || apiError?.status === 403) {
        if (provider.validation?.valid && provider.validation.verifiedVia === 'chat') {
          patchProvider(providerId, {
            modelsError: `${message} Verifikasi lewat chat tetap aktif; tambahkan model secara manual.`,
          });
          return;
        }
        patchProvider(providerId, {
          verified: false,
          resolvedBaseUrl: '',
          validation: {
            ok: false,
            valid: false,
            keyStatus: 'invalid',
            baseUrl: provider.baseUrl,
            host: hostFromUrl(provider.baseUrl),
            latencyMs: null,
            modelCount: null,
            message,
            details: apiError.details,
            httpStatus: apiError.status,
            keyAdjusted: apiError.keyAdjusted,
          },
          chatModel:
            !provider.chatModel && isTipRouterHost(provider.baseUrl)
              ? TIPROUTER_CHAT_MODEL
              : provider.chatModel,
        });
      }
    } finally {
      if (isCurrent()) patchProvider(providerId, { modelsLoading: false });
    }
  }

  async function handleValidateChat(providerId: string, event: FormEvent) {
    event.preventDefault();
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    const model = provider.chatModel.trim();

    if (!provider.baseUrl.trim()) {
      patchProvider(providerId, { connectError: 'Isi API Base URL terlebih dahulu.' });
      return;
    }
    if (!model) {
      patchProvider(providerId, { chatError: 'Isi ID model yang tersedia di provider ini.' });
      return;
    }

    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const isCurrent = () => requestAbortRef.current === controller;

    patchProvider(providerId, { chatValidating: true, chatError: null, connectError: null });

    try {
      const result = await validateProviderWithChat(
        provider.baseUrl,
        provider.apiKey,
        model,
        controller.signal,
      );
      if (!isCurrent()) return;

      if (!result.valid) {
        patchProvider(providerId, {
          validation: result,
          verified: false,
          resolvedBaseUrl: '',
          chatError: result.message,
        });
        return;
      }

      setProviders((previous) =>
        previous.map((item) => {
          if (item.id !== providerId) return item;
          const models = item.models.some((entry) => entry.id === model)
            ? item.models
            : [...item.models, { id: model, name: model, manual: true }].sort((a, b) =>
                a.id.localeCompare(b.id),
              );
          const total = previous.reduce((sum, entry) => sum + entry.selected.length, 0);
          const selected =
            item.selected.includes(model) || total >= MAX_MODELS
              ? item.selected
              : [...item.selected, model];
          return {
            ...item,
            models,
            selected,
            verified: true,
            resolvedBaseUrl: result.baseUrl,
            validation: result,
            modelsError: null,
          };
        }),
      );
      setNotice(`Key valid lewat chat. ${model} ditambahkan dan siap diuji.`);
      if (result.keyAdjusted) {
        setNotice('Key valid. Prefix Bearer, kutip, atau karakter tak terlihat dibersihkan otomatis.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!isCurrent()) return;
      patchProvider(providerId, {
        chatError: errorMessage(error),
        verified: false,
        resolvedBaseUrl: '',
      });
    } finally {
      if (isCurrent()) patchProvider(providerId, { chatValidating: false });
    }
  }

  function toggleModel(providerId: string, modelId: string) {
    if (phase === 'running') return;
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    if (!provider.selected.includes(modelId) && selectedCount >= MAX_MODELS) {
      setNotice(`Maksimal ${MAX_MODELS} model per pengujian.`);
      return;
    }
    setProviders((previous) =>
      previous.map((item) =>
        item.id === providerId
          ? {
              ...item,
              selected: item.selected.includes(modelId)
                ? item.selected.filter((id) => id !== modelId)
                : [...item.selected, modelId],
            }
          : item,
      ),
    );
  }

  function selectAllVisible() {
    if (phase === 'running') return;
    let remaining = MAX_MODELS - selectedCount;
    if (remaining <= 0) {
      setNotice(`Maksimal ${MAX_MODELS} model per pengujian.`);
      return;
    }

    const additions = new Map<string, string[]>();
    for (const entry of visibleEntries) {
      if (remaining <= 0) break;
      if (entry.provider.selected.includes(entry.model.id)) continue;
      const current = additions.get(entry.provider.id) ?? [];
      if (current.includes(entry.model.id)) continue;
      additions.set(entry.provider.id, [...current, entry.model.id]);
      remaining -= 1;
    }

    if (!additions.size) return;
    setProviders((previous) =>
      previous.map((provider) =>
        additions.has(provider.id)
          ? { ...provider, selected: [...provider.selected, ...(additions.get(provider.id) ?? [])] }
          : provider,
      ),
    );
    if (remaining <= 0) {
      setNotice(`Ditambahkan hingga batas maksimal ${MAX_MODELS} model.`);
    }
  }

  function clearSelection() {
    setProviders((previous) => previous.map((provider) => ({ ...provider, selected: [] })));
  }

  function addManualModel(event: FormEvent) {
    event.preventDefault();
    const id = manualModel.trim();
    if (!id || !activeProvider) return;
    const providerId = activeProvider.id;
    setProviders((previous) =>
      previous.map((provider) => {
        if (provider.id !== providerId) return provider;
        const models = provider.models.some((model) => model.id === id)
          ? provider.models
          : [...provider.models, { id, name: id, manual: true }].sort((a, b) =>
              a.id.localeCompare(b.id),
            );
        const total = previous.reduce((sum, item) => sum + item.selected.length, 0);
        const selected =
          provider.selected.includes(id) || total >= MAX_MODELS
            ? provider.selected
            : [...provider.selected, id];
        return { ...provider, models, selected };
      }),
    );
    setManualModel('');
  }

  function handleRunEvent(event: BenchmarkEvent) {
    switch (event.type) {
      case 'start':
        setBenchTotal(retryRef.current?.total ?? event.jobs.length);
        break;
      case 'sample_start':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? {
                  ...run,
                  status: 'running',
                  content: '',
                  reasoning: '',
                  ttftMs: null,
                  elapsedMs: null,
                  repetition: event.index,
                  sampleTotal: event.total,
                }
              : run,
          ),
        );
        break;
      case 'model_start':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key ? { ...run, status: 'running' } : run,
          ),
        );
        break;
      case 'first_token':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? {
                  ...run,
                  status: 'streaming',
                  ttftMs: run.ttftMs ?? event.ttftMs,
                }
              : run,
          ),
        );
        break;
      case 'delta':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? {
                  ...run,
                  status: 'streaming',
                  content: run.content + event.content,
                  reasoning: run.reasoning + event.reasoning,
                  ttftMs: run.ttftMs ?? event.ttftMs,
                  elapsedMs: event.elapsedMs,
                }
              : run,
          ),
        );
        break;
      case 'retry':
        setRetryCount((count) => count + 1);
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? { ...run, retries: run.retries + 1, status: 'running' }
              : run,
          ),
        );
        break;
      case 'sample_done':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? {
                  ...run,
                  repetition: event.index,
                  sampleTotal: event.total,
                  samples: [...run.samples, event.result],
                  elapsedMs: event.result.e2eMs ?? event.result.totalMs,
                }
              : run,
          ),
        );
        break;
      case 'done':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? {
                  ...run,
                  status: 'done',
                  content: event.result.content,
                  reasoning: event.result.reasoning,
                  ttftMs: event.result.ttftMs,
                  elapsedMs: event.result.e2eMs ?? event.result.totalMs,
                  result: event.result,
                  samples: event.samples,
                  stats: event.stats,
                  retries: event.retries,
                  failedSamples: event.failedSamples,
                  error: null,
                }
              : run,
          ),
        );
        break;
      case 'model_error':
        setRuns((previous) =>
          previous.map((run) =>
            run.key === event.key
              ? {
                  ...run,
                  status: 'error',
                  error: event.error,
                  retries: event.retries,
                  failedSamples: event.failedSamples,
                }
              : run,
          ),
        );
        break;
      case 'progress':
        setCompleted(
          retryRef.current
            ? retryRef.current.previousDone + event.completed
            : event.completed,
        );
        break;
      case 'complete': {
        const retryContext = retryRef.current;
        setCompleted(retryContext ? retryContext.total : event.completed);
        setBenchTotal(retryContext ? retryContext.total : event.total);
        if (!retryContext) setWallTotalMs(event.totalMs);
        setRetryCount(
          retryContext
            ? retryContext.previousRetries + event.retries
            : event.retries,
        );
        setPhase('finished');
        break;
      }
      default:
        break;
    }
  }

  async function handleRun() {
    if (!canRun) return;

    const chosen = runnableProviders
      .filter((provider) => provider.selected.length > 0 && provider.resolvedBaseUrl)
      .map((provider) => ({
        provider,
        models: [...provider.selected],
      }));
    if (!chosen.length) return;

    const jobs: RunJob[] = chosen.flatMap(({ provider, models }) =>
      models.map((model) => ({
        key: modelKey(provider.id, model),
        providerId: provider.id,
        providerLabel: provider.label,
        providerHost: hostFromUrl(provider.resolvedBaseUrl || provider.baseUrl),
        model,
      })),
    );

    const controller = new AbortController();
    runAbortRef.current = controller;
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = runId;
    savedRunRef.current = null;
    retryRef.current = null;

    setRuns(jobs.map(emptyRun));
    setBenchTotal(jobs.length);
    setCompleted(0);
    setWallTotalMs(null);
    setRunError(null);
    setWasStopped(false);
    setRetryCount(0);
    setRunSettings({ prompt, systemPrompt, temperature, maxTokens, concurrency, repetitions });
    setPhase('running');

    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);

    try {
      await streamBenchmark(
        {
          providers: chosen.map(({ provider, models }) => ({
            id: provider.id,
            label: provider.label,
            baseUrl: provider.baseUrl,
            resolvedBaseUrl: provider.resolvedBaseUrl,
            apiKey: provider.apiKey,
            models,
          })),
          prompt,
          systemPrompt,
          temperature,
          maxTokens,
          concurrency,
          repetitions,
        },
        handleRunEvent,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setPhase((previous) => (previous === 'running' ? 'finished' : previous));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = errorMessage(error);
      setRunError(message);
      setPhase('finished');
      setRuns((previous) =>
        previous.map((run) =>
          run.status === 'queued' || run.status === 'running' || run.status === 'streaming'
            ? {
                ...run,
                status: 'error',
                error: {
                  name: 'BenchmarkError',
                  code: 'benchmark_failed',
                  status: 0,
                  message,
                },
              }
            : run,
        ),
      );
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
    }
  }

  function handleStop() {
    if (!runAbortRef.current) return;
    runAbortRef.current.abort();
    setWasStopped(true);
    setPhase('finished');
    setRuns((previous) =>
      previous.map((run) =>
        run.status === 'queued' || run.status === 'running' || run.status === 'streaming'
          ? {
              ...run,
              status: 'error',
              error: {
                name: 'AbortError',
                code: 'aborted',
                status: 0,
                message: 'Pengujian dihentikan oleh pengguna sebelum model selesai.',
              },
            }
          : run,
      ),
    );
  }

  async function retryFailedModels(keys?: string[]) {
    if (phase === 'running') return;

    const requested = keys?.length
      ? new Set(keys)
      : new Set(runs.filter((run) => run.status === 'error').map((run) => run.key));
    const targets = runs.filter((run) => requested.has(run.key) && run.status === 'error');
    if (!targets.length) {
      setNotice('Tidak ada model gagal yang bisa diulang.');
      return;
    }

    const grouped = new Map<string, { provider: ProviderProfile; models: string[] }>();
    const skipped: string[] = [];
    for (const target of targets) {
      const provider = providers.find((item) => item.id === target.providerId);
      if (!provider || !provider.verified || !provider.resolvedBaseUrl) {
        skipped.push(target.model);
        continue;
      }
      const existing = grouped.get(provider.id);
      if (existing) {
        if (!existing.models.includes(target.model)) existing.models.push(target.model);
      } else {
        grouped.set(provider.id, { provider, models: [target.model] });
      }
    }

    if (!grouped.size) {
      setNotice(
        'Provider untuk model gagal belum terverifikasi. Isi API key, uji koneksi, lalu ulangi.',
      );
      return;
    }

    const retryKeys = new Set<string>();
    for (const entry of grouped.values()) {
      for (const model of entry.models) retryKeys.add(modelKey(entry.provider.id, model));
    }

    const controller = new AbortController();
    runAbortRef.current = controller;
    savedRunRef.current = null;
    const previousDone = runs.filter((run) => run.status === 'done').length;
    const previousRetries = runs.reduce((sum, run) => sum + run.retries, 0);
    retryRef.current = { total: runs.length, previousDone, previousRetries };

    setRuns((previous) =>
      previous.map((run) =>
        retryKeys.has(run.key)
          ? {
              ...emptyRun({
                key: run.key,
                providerId: run.providerId,
                providerLabel: run.providerLabel,
                providerHost: run.providerHost,
                model: run.model,
              }),
              sampleTotal: runSettings.repetitions,
            }
          : run,
      ),
    );
    setCompleted(previousDone);
    setBenchTotal(runs.length);
    setRunError(null);
    setWasStopped(false);
    setRetryCount(previousRetries);
    setPhase('running');
    setNotice(
      `Mengulangi ${retryKeys.size} model gagal` +
        (skipped.length
          ? `; ${skipped.length} model dilewati karena provider belum terverifikasi.`
          : '.'),
    );

    try {
      await streamBenchmark(
        {
          providers: [...grouped.values()].map(({ provider, models }) => ({
            id: provider.id,
            label: provider.label,
            baseUrl: provider.baseUrl,
            resolvedBaseUrl: provider.resolvedBaseUrl,
            apiKey: provider.apiKey,
            models,
          })),
          prompt: runSettings.prompt,
          systemPrompt: runSettings.systemPrompt,
          temperature: runSettings.temperature,
          maxTokens: runSettings.maxTokens,
          concurrency: runSettings.concurrency,
          repetitions: runSettings.repetitions,
        },
        handleRunEvent,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setPhase((previous) => (previous === 'running' ? 'finished' : previous));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = errorMessage(error);
      setRunError(message);
      setPhase('finished');
      setRuns((previous) =>
        previous.map((run) =>
          retryKeys.has(run.key) &&
          (run.status === 'queued' || run.status === 'running' || run.status === 'streaming')
            ? {
                ...run,
                status: 'error',
                error: {
                  name: 'BenchmarkError',
                  code: 'benchmark_failed',
                  status: 0,
                  message,
                },
              }
            : run,
        ),
      );
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      retryRef.current = null;
    }
  }

  function handleExportCsv() {
    if (!runs.length) return;
    downloadCsv(
      `frontstellar-assess-${timestampSlug()}.csv`,
      buildResultRows(runs, runSettings.prompt),
    );
  }

  function handleExportJson() {
    if (!runs.length) return;
    downloadJson(
      `frontstellar-assess-${timestampSlug()}.json`,
      buildExportPayload(runSettings, runs, wallTotalMs, new Date().toISOString()),
    );
  }

  function loadHistoryEntry(entry: HistoryEntry) {
    runAbortRef.current?.abort();
    retryRef.current = null;
    runIdRef.current = entry.id;
    savedRunRef.current = entry.id;
    const settings: RunSettings = {
      prompt: entry.prompt,
      systemPrompt: entry.systemPrompt,
      temperature: entry.temperature,
      maxTokens: entry.maxTokens,
      concurrency: entry.concurrency,
      repetitions: entry.repetitions,
    };
    setRuns(entry.runs);
    setRunSettings(settings);
    setPrompt(entry.prompt);
    setSystemPrompt(entry.systemPrompt);
    setShowSystem(Boolean(entry.systemPrompt));
    setTemperature(entry.temperature);
    setMaxTokens(entry.maxTokens);
    setConcurrency(entry.concurrency);
    setRepetitions(entry.repetitions);
    setBenchTotal(entry.runs.length);
    setCompleted(entry.runs.filter((run) => run.status === 'done').length);
    setWallTotalMs(entry.wallTotalMs);
    setRunError(null);
    setWasStopped(false);
    setRetryCount(entry.runs.reduce((sum, run) => sum + run.retries, 0));
    setPhase('finished');
    setNotice('Riwayat dimuat ke tampilan hasil.');
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  function exportHistoryCsv(entry: HistoryEntry) {
    downloadCsv(
      `frontstellar-riwayat-${timestampSlug(new Date(entry.createdAt))}.csv`,
      buildResultRows(entry.runs, entry.prompt),
    );
  }

  function exportHistoryJson(entry: HistoryEntry) {
    const settings: RunSettings = {
      prompt: entry.prompt,
      systemPrompt: entry.systemPrompt,
      temperature: entry.temperature,
      maxTokens: entry.maxTokens,
      concurrency: entry.concurrency,
      repetitions: entry.repetitions,
    };
    downloadJson(
      `frontstellar-riwayat-${timestampSlug(new Date(entry.createdAt))}.json`,
      buildExportPayload(settings, entry.runs, entry.wallTotalMs, entry.createdAt),
    );
  }

  function handleExportPng() {
    if (!runs.length) return;
    downloadSummaryPng(
      `frontstellar-assess-${timestampSlug()}.png`,
      runs,
      runSettings.prompt,
      accentColor(preferences.accent),
    );
    setNotice('Kartu ringkasan PNG sedang diunduh.');
  }

  function loadDemoMode(autoRun: boolean) {
    if (phase === 'running') {
      setNotice('Hentikan benchmark yang berjalan sebelum memuat mode demo.');
      return;
    }
    const baseUrl = demoBaseUrl();
    const existing = providers.find((provider) => provider.baseUrl === baseUrl);
    const demoProvider: ProviderProfile = {
      ...createProvider(providers.length, baseUrl),
      id: existing?.id ?? `prov-demo-${Math.random().toString(36).slice(2, 8)}`,
      label: 'Demo lokal',
      apiKey: 'demo-key',
      resolvedBaseUrl: baseUrl,
      verified: true,
      validation: {
        ok: true,
        valid: true,
        keyStatus: 'valid',
        baseUrl,
        host: hostFromUrl(baseUrl),
        latencyMs: 0,
        modelCount: DEMO_MODELS.length,
        message: 'Mode demo lokal siap tanpa biaya API.',
        verifiedVia: 'models',
      },
      models: DEMO_MODELS,
      modelsError: null,
      selected: DEMO_MODELS.map((model) => model.id),
    };

    setProviders((previous) => {
      const base = autoRun
        ? previous.map((provider) => ({ ...provider, selected: [] }))
        : previous;
      if (existing) {
        return base.map((provider) =>
          provider.id === existing.id
            ? { ...provider, ...demoProvider, id: existing.id, label: demoProvider.label }
            : provider,
        );
      }
      if (base.length >= MAX_PROVIDERS) {
        return [demoProvider, ...base.slice(1)];
      }
      return [...base, demoProvider];
    });
    setActiveId(demoProvider.id);
    if (!prompt.trim()) setPrompt(DEFAULT_PROMPT);
    if (autoRun) demoRunRef.current = true;
    setUndo(null);
    setNotice(
      autoRun
        ? 'Mode demo dimuat — benchmark dijalankan otomatis.'
        : 'Mode demo siap. Tekan Jalankan benchmark atau R.',
    );
  }

  function toggleTheme() {
    setPreferences((previous) => ({
      ...previous,
      theme: previous.theme === 'dark' ? 'light' : 'dark',
    }));
  }

  function cycleAccent() {
    setPreferences((previous) => ({ ...previous, accent: nextAccent(previous.accent) }));
  }

  function toggleReducedMotion() {
    setPreferences((previous) => ({ ...previous, reducedMotion: !previous.reducedMotion }));
  }

  function deleteHistoryEntry(id: string) {
    const index = history.findIndex((entry) => entry.id === id);
    const entry = history[index];
    if (!entry) return;
    setHistory(removeHistory(id));
    setNotice(null);
    setUndo({
      message: 'Riwayat pengujian dihapus.',
      restore: () => {
        setHistory((current) => {
          const next = current.some((item) => item.id === entry.id)
            ? current
            : [...current.slice(0, index), entry, ...current.slice(index)];
          return replaceHistory(next);
        });
      },
    });
  }

  function clearAllHistory() {
    const previous = history;
    if (!previous.length) return;
    setHistory(clearHistory());
    setNotice(null);
    setUndo({
      message: `${previous.length} riwayat dihapus.`,
      restore: () => setHistory(replaceHistory(previous)),
    });
  }

  function handleDeleteSavedProviderUndo(savedId: string) {
    const index = savedProviders.findIndex((entry) => entry.id === savedId);
    const entry = savedProviders[index];
    if (!entry) return;
    handleDeleteSavedProvider(savedId);
    setUndo({
      message: `Provider tersimpan "${entry.name}" dihapus.`,
      restore: () =>
        setSavedProviders((current) => {
          if (current.some((item) => item.id === entry.id)) return current;
          const next = [...current];
          next.splice(Math.min(index, next.length), 0, entry);
          return next;
        }),
    });
  }

  const paletteActions: PaletteAction[] = [
    {
      id: 'run',
      label: 'Jalankan benchmark',
      hint: runHint,
      keywords: 'mulai run uji benchmark start',
      icon: Play,
      disabled: !canRun,
      run: () => void handleRun(),
    },
    {
      id: 'stop',
      label: 'Hentikan benchmark',
      hint: 'Batalkan pengujian yang sedang berjalan',
      keywords: 'stop berhenti batal',
      icon: Square,
      disabled: phase !== 'running',
      run: () => handleStop(),
    },
    {
      id: 'retry',
      label: 'Ulangi model yang gagal',
      hint: `${runs.filter((run) => run.status === 'error').length} model gagal`,
      keywords: 'retry ulangi gagal error',
      icon: RotateCcw,
      disabled: phase === 'running' || !runs.some((run) => run.status === 'error'),
      run: () => void retryFailedModels(),
    },
    {
      id: 'demo',
      label: 'Muat & jalankan mode demo',
      hint: 'Provider demo lokal tanpa API key dan tanpa biaya',
      keywords: 'demo contoh mock coba',
      icon: WandSparkles,
      disabled: phase === 'running',
      run: () => loadDemoMode(true),
    },
    {
      id: 'demo-load',
      label: 'Muat mode demo tanpa menjalankan',
      hint: 'Isi provider demo dan pilih empat model',
      keywords: 'demo contoh mock isi',
      icon: Sparkles,
      disabled: phase === 'running',
      run: () => loadDemoMode(false),
    },
    {
      id: 'theme',
      label: preferences.theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap',
      hint: 'Tema saat ini: ' + (preferences.theme === 'dark' ? 'gelap' : 'terang'),
      keywords: 'tema terang gelap dark light',
      icon: preferences.theme === 'dark' ? Sun : Moon,
      run: toggleTheme,
    },
    {
      id: 'accent',
      label: 'Ganti warna aksen',
      hint: `Aksen aktif: ${preferences.accent}`,
      keywords: 'warna aksen lime cyan amber',
      icon: Palette,
      run: cycleAccent,
    },
    {
      id: 'motion',
      label: preferences.reducedMotion ? 'Aktifkan animasi' : 'Kurangi animasi',
      hint: preferences.reducedMotion ? 'Reduced motion aktif' : 'Matikan animasi berlebih',
      keywords: 'animasi gerak motion aksesibilitas',
      icon: Zap,
      run: toggleReducedMotion,
    },
    {
      id: 'png',
      label: 'Ekspor kartu ringkasan PNG',
      hint: 'Unduh podium dan tabel sebagai gambar',
      keywords: 'png gambar share ekspor',
      icon: ImageIcon,
      disabled: !runs.length,
      run: handleExportPng,
    },
    {
      id: 'csv',
      label: 'Ekspor hasil ke CSV',
      keywords: 'csv ekspor unduh',
      icon: Download,
      disabled: !runs.length,
      run: handleExportCsv,
    },
    {
      id: 'json',
      label: 'Ekspor hasil ke JSON',
      keywords: 'json ekspor unduh',
      icon: FileJson,
      disabled: !runs.length,
      run: handleExportJson,
    },
    {
      id: 'shortcuts',
      label: 'Buka bantuan shortcut',
      hint: 'Daftar tombol pintas keyboard',
      keywords: 'keyboard bantuan shortcut help',
      icon: Keyboard,
      run: () => setShortcutsOpen(true),
    },
    {
      id: 'connect',
      label: 'Lompat ke koneksi provider',
      keywords: 'provider koneksi api key url',
      icon: Server,
      run: () => document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth' }),
    },
    {
      id: 'models',
      label: 'Lompat ke pemilihan model',
      keywords: 'model pilih peserta',
      icon: Cpu,
      run: () => document.getElementById('benchmark')?.scrollIntoView({ behavior: 'smooth' }),
    },
    {
      id: 'results',
      label: 'Lompat ke hasil benchmark',
      keywords: 'hasil grafik arena',
      icon: Gauge,
      disabled: phase === 'idle',
      run: () => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    {
      id: 'history',
      label: 'Lompat ke riwayat',
      keywords: 'riwayat arsip history',
      icon: History,
      run: () => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' }),
    },
    ...providers.map((provider, index) => ({
      id: `provider-${provider.id}`,
      label: `Pindah ke ${provider.label}`,
      hint: provider.baseUrl ? hostFromUrl(provider.resolvedBaseUrl || provider.baseUrl) : 'Belum diisi',
      keywords: `provider tab ${index + 1}`,
      icon: Server,
      run: () => setActiveId(provider.id),
    })),
  ];

  if (!activeProvider) return null;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#top" aria-label="FrontStellar Assess, kembali ke atas">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="brand-text">
              Front<span>Stellar</span>
            </span>
            <span className="brand-label">ASSESS</span>
          </a>
          <div className="header-actions">
            <div className="appearance-controls" role="group" aria-label="Tampilan dan akses cepat">
              <button
                type="button"
                className="header-icon"
                onClick={toggleTheme}
                title={preferences.theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
                aria-label={preferences.theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap'}
              >
                {preferences.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                type="button"
                className="header-icon accent-icon"
                onClick={cycleAccent}
                title={`Ganti warna aksen (aktif: ${preferences.accent})`}
                aria-label="Ganti warna aksen"
              >
                <Palette size={15} />
                <span
                  className="accent-swatch"
                  style={{ background: accentColor(preferences.accent) }}
                />
              </button>
              <button
                type="button"
                className={`header-icon ${preferences.reducedMotion ? 'active' : ''}`}
                onClick={toggleReducedMotion}
                title={
                  preferences.reducedMotion
                    ? 'Aktifkan kembali animasi'
                    : 'Kurangi animasi dan efek gerak'
                }
                aria-label="Alihkan pengurangan animasi"
                aria-pressed={preferences.reducedMotion}
              >
                <Zap size={15} />
              </button>
              <button
                type="button"
                className="header-icon"
                onClick={() => setPaletteOpen(true)}
                title="Command palette (Ctrl/Cmd + K)"
                aria-label="Buka command palette"
              >
                <Command size={15} />
              </button>
              <button
                type="button"
                className="header-icon"
                onClick={() => setShortcutsOpen(true)}
                title="Bantuan shortcut (?)"
                aria-label="Buka bantuan shortcut"
              >
                <Keyboard size={15} />
              </button>
            </div>
            <span className={`header-status ${phase === 'running' ? 'busy' : ''}`}>
              <span className="status-dot" />
              {phase === 'running' ? 'Benchmark aktif' : 'Proxy lokal siap'}
            </span>
            <a className="header-link" href="#connect">
              Mulai uji
              <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={14} />
              Multi-provider · grafik · statistik
            </div>
            <h1>
              Satu prompt.
              <br />
              <span className="accent">Semua model.</span>
              <br />
              Bukti performa.
            </h1>
            <p className="hero-lead">
              Bandingkan TTFT, TPS, dan latency E2E lintas provider dalam satu layar. Atur berapa
              model yang berjalan bersamaan, ulangi pengujian untuk statistik, dan lihat hasilnya
              sebagai diagram.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#connect">
                Mulai benchmark
                <ArrowRight size={16} />
              </a>
              <button
                type="button"
                className="button secondary"
                onClick={() => loadDemoMode(true)}
                disabled={phase === 'running'}
                title="Muat provider demo lokal dan langsung jalankan benchmark"
              >
                <WandSparkles size={16} />
                Coba mode demo
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() => setPaletteOpen(true)}
              >
                <Command size={15} />
                Ctrl / ⌘ + K
              </button>
            </div>
            <div className="trust-row">
              <ShieldCheck size={15} />
              API key hanya berada di memori sesi dan diteruskan lewat proxy lokal.
            </div>
          </div>

          <aside className="scoreboard" aria-label="Metrik yang diukur">
            <div className="scoreboard-top">
              <span>
                <Gauge size={15} />
                LIVE SCORECARD
              </span>
              <span className="stream-tag">STREAM ON</span>
            </div>
            <div className="scoreboard-rows">
              <div className="score-row">
                <span className="score-number">01</span>
                <span className="score-icon ttft">
                  <Timer size={18} />
                </span>
                <div>
                  <strong>TTFT</strong>
                  <span>Time to first token</span>
                </div>
                <span className="score-unit">ms</span>
              </div>
              <div className="score-row">
                <span className="score-number">02</span>
                <span className="score-icon tps">
                  <Gauge size={18} />
                </span>
                <div>
                  <strong>TPS</strong>
                  <span>Generation velocity</span>
                </div>
                <span className="score-unit">tok/s</span>
              </div>
              <div className="score-row">
                <span className="score-number">03</span>
                <span className="score-icon total">
                  <Sparkles size={18} />
                </span>
                <div>
                  <strong>E2E</strong>
                  <span>End-to-end latency</span>
                </div>
                <span className="score-unit">sec</span>
              </div>
            </div>
            <div className="scoreboard-bottom">
              <span>
                <span className="mini-dot" />
                Hingga 100 model · 6 provider
              </span>
              <span>GRAFIK + STATISTIK</span>
            </div>
          </aside>
        </section>

        <section className="panel connection-panel" id="connect">
          <div className="section-heading">
            <span className="step-number">01</span>
            <div>
              <div className="eyebrow small">Koneksi provider</div>
              <h2>Hubungkan satu atau beberapa endpoint</h2>
            </div>
            <span className="section-tag">
              <Server size={13} />
              {providers.length} provider
            </span>
          </div>

          <div className="provider-tabs" role="tablist" aria-label="Pilih provider">
            {providers.map((provider) => (
              <button
                type="button"
                key={provider.id}
                role="tab"
                aria-selected={provider.id === activeProvider.id}
                className={`provider-tab ${provider.id === activeProvider.id ? 'active' : ''} ${
                  provider.verified ? 'verified' : ''
                }`}
                onClick={() => setActiveId(provider.id)}
              >
                <span className="provider-tab-dot" />
                <span className="provider-tab-body">
                  <strong>{provider.label}</strong>
                  <small>
                    {provider.baseUrl
                      ? hostFromUrl(provider.resolvedBaseUrl || provider.baseUrl)
                      : 'Belum diisi'}
                  </small>
                </span>
                {provider.verified && <CheckCircle2 size={14} className="provider-tab-check" />}
              </button>
            ))}
            <button
              type="button"
              className="provider-add"
              onClick={addProvider}
              disabled={providers.length >= MAX_PROVIDERS || phase === 'running'}
              title={`Tambah provider (maks. ${MAX_PROVIDERS})`}
            >
              <Plus size={14} />
              Provider
            </button>
          </div>

          {providers.length > 1 && (
            <div className="provider-tab-actions">
              <span>
                <Layers size={13} />
                Provider aktif: <strong>{activeProvider.label}</strong>
              </span>
              <button
                type="button"
                className="text-button muted"
                onClick={() => removeProvider(activeProvider.id)}
                disabled={phase === 'running'}
              >
                <Trash2 size={13} />
                Hapus provider ini
              </button>
            </div>
          )}

          <div className="saved-provider-panel">
            <div className="saved-provider-head">
              <span className="saved-provider-label">
                <Bookmark size={13} />
                Provider tersimpan
                {savedProviders.length > 0 && <em>{savedProviders.length}</em>}
              </span>
              <button
                type="button"
                className="button secondary small-button"
                onClick={handleSaveProvider}
                disabled={busy || !activeProvider.baseUrl.trim()}
                title="Simpan konfigurasi provider aktif tanpa API key"
              >
                <Save size={14} />
                Simpan provider
              </button>
            </div>

            {savedProviders.length > 0 ? (
              <div className="saved-provider-list">
                {savedProviders.map((saved) => {
                  const current = saved.baseUrl === activeProvider.baseUrl;
                  return (
                    <div
                      className={`saved-provider-item ${current ? 'is-current' : ''}`}
                      key={saved.id}
                    >
                      <button
                        type="button"
                        className="saved-provider-load"
                        onClick={() => handleUseSavedProvider(saved.id)}
                        disabled={phase === 'running'}
                        title={`Gunakan ${saved.baseUrl} (API key perlu diisi ulang)`}
                      >
                        <span className="saved-provider-name">{saved.name}</span>
                        <small>
                          {hostFromUrl(saved.baseUrl)} · {saved.selected.length} model
                          {current ? ' · sedang dipakai' : ''}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="icon-button tiny"
                        onClick={() => handleDeleteSavedProviderUndo(saved.id)}
                        disabled={phase === 'running'}
                        aria-label={`Hapus ${saved.name}`}
                        title="Hapus dari daftar tersimpan"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="saved-provider-empty">
                Belum ada provider tersimpan. Isi Base URL, pilih model, lalu klik{' '}
                <strong>Simpan provider</strong> untuk memakainya lagi nanti. API key tidak ikut
                disimpan.
              </p>
            )}
          </div>

          <div className="connection-grid">
            <div className="field">
              <label className="field-label" htmlFor={`base-url-${activeProvider.id}`}>
                API Base URL
                <span className="field-optional">wajib</span>
              </label>
              <span className="input-shell">
                <Link2 size={17} />
                <input
                  id={`base-url-${activeProvider.id}`}
                  type="url"
                  value={activeProvider.baseUrl}
                  onChange={(event) => handleBaseUrlChange(event.target.value)}
                  placeholder="https://api.provider.com/v1"
                  autoComplete="url"
                  spellCheck={false}
                  aria-label="API Base URL"
                  disabled={busy}
                />
              </span>
              <span className="field-help">Sertakan path versi API, misalnya /v1 atau /openai/v1.</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor={`api-key-${activeProvider.id}`}>
                API Key
                <span className="field-optional">opsional untuk lokal</span>
              </label>
              <span className="input-shell">
                <KeyRound size={17} />
                <input
                  id={`api-key-${activeProvider.id}`}
                  type={activeProvider.showKey ? 'text' : 'password'}
                  value={activeProvider.apiKey}
                  onChange={(event) => handleApiKeyChange(event.target.value)}
                  placeholder="sk-••••••••••••••••"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="API Key"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="icon-button inline"
                  onClick={() =>
                    patchProvider(activeProvider.id, { showKey: !activeProvider.showKey })
                  }
                  aria-label={activeProvider.showKey ? 'Sembunyikan API key' : 'Tampilkan API key'}
                  tabIndex={-1}
                >
                  {activeProvider.showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              <span className="field-help">
                <LockKeyhole size={12} />
                Hanya berada di memori sesi. Tidak ditulis ke localStorage.
              </span>
            </div>
          </div>

          <div className="provider-row">
            <span className="provider-label">Isi cepat</span>
            <div className="provider-pills">
              {PROVIDER_PRESETS.map((provider) => (
                <button
                  type="button"
                  key={provider.label}
                  className="provider-pill"
                  onClick={() => applyProviderPreset(provider.url, provider.model)}
                  disabled={busy}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          </div>

          <div className="connection-actions">
            <div className="connection-buttons">
              <button
                type="button"
                className="button primary"
                onClick={() => handleValidate(activeProvider.id)}
                disabled={busy || !activeProvider.baseUrl.trim()}
              >
                {activeProvider.validating ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                {activeProvider.validating ? 'Memeriksa key…' : 'Uji API key'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => handleLoadModels(activeProvider.id)}
                disabled={busy || !activeProvider.baseUrl.trim()}
              >
                {activeProvider.modelsLoading ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {activeProvider.modelsLoading
                  ? 'Memuat model…'
                  : activeProvider.models.length
                    ? 'Muat ulang model'
                    : 'Muat model'}
              </button>
              <span className="connection-hint">
                Uji key memastikan kredensial diterima. Muat model mengambil daftar model yang
                tersedia di provider aktif.
              </span>
            </div>
          </div>

          {activeProvider.validating && (
            <div className="connection-result checking">
              <LoaderCircle size={18} className="spin" />
              <div>
                <strong>Menghubungi provider</strong>
                <p>Memeriksa kredensial melalui endpoint /models…</p>
              </div>
            </div>
          )}

          {!activeProvider.validating && activeProvider.validation && (
            <div className={`connection-result ${activeStatusTone}`}>
              {activeProvider.validation.valid ? (
                <CheckCircle2 size={19} />
              ) : activeProvider.validation.keyStatus === 'invalid' ? (
                <AlertTriangle size={19} />
              ) : (
                <Info size={19} />
              )}
              <div>
                <strong>
                  {activeProvider.validation.valid
                    ? 'API key dapat digunakan'
                    : activeProvider.validation.keyStatus === 'invalid'
                      ? 'API key tidak dapat digunakan'
                      : 'Kredensial belum dapat diverifikasi'}
                </strong>
                <p>
                  {activeProvider.validation.host}
                  {activeProvider.validation.latencyMs != null &&
                    ` · ${formatLatency(activeProvider.validation.latencyMs)}`}
                  {activeProvider.validation.modelCount != null &&
                    ` · ${activeProvider.validation.modelCount.toLocaleString('id-ID')} model`}
                  {activeProvider.validation.valid &&
                    activeProvider.validation.verifiedVia === 'chat' &&
                    ' · terverifikasi via chat'}
                  {!activeProvider.validation.valid &&
                    ` · ${activeProvider.validation.message}`}
                </p>
                {activeProvider.validation.keyAdjusted && (
                  <span className="result-detail">
                    Key dinormalisasi otomatis: prefix Bearer, kutip, atau karakter tak terlihat
                    dibersihkan.
                  </span>
                )}
                {activeProvider.validation.details && (
                  <span className="result-detail">{activeProvider.validation.details}</span>
                )}
              </div>
              {activeProvider.validation.valid && (
                <span className="verified-tag">TERVERIFIKASI</span>
              )}
            </div>
          )}

          {!activeProvider.validating && !activeProvider.validation && activeProvider.connectError && (
            <div className="connection-result error">
              <AlertTriangle size={19} />
              <div>
                <strong>Koneksi gagal</strong>
                <p>{activeProvider.connectError}</p>
              </div>
            </div>
          )}

          {showChatFallback && (
            <div className="chat-fallback">
              <div className="chat-fallback-head">
                <MessageSquare size={18} />
                <div>
                  <strong>Verifikasi lewat chat</strong>
                  <p>
                    Beberapa provider membatasi endpoint <code>/models</code> meskipun key-nya
                    valid. Uji key dengan satu permintaan chat singkat memakai model yang Anda tahu
                    tersedia.
                  </p>
                </div>
              </div>
              <form
                className="chat-fallback-form"
                onSubmit={(event) => handleValidateChat(activeProvider.id, event)}
              >
                <input
                  type="text"
                  value={activeProvider.chatModel}
                  onChange={(event) =>
                    patchProvider(activeProvider.id, { chatModel: event.target.value })
                  }
                  placeholder="mis. deepseek-v-4.1-flash"
                  aria-label="ID model untuk verifikasi chat"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={activeProvider.chatValidating || phase === 'running'}
                />
                <button
                  type="submit"
                  className="button secondary"
                  disabled={
                    activeProvider.chatValidating ||
                    !activeProvider.chatModel.trim() ||
                    !activeProvider.baseUrl.trim() ||
                    phase === 'running'
                  }
                >
                  {activeProvider.chatValidating ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  {activeProvider.chatValidating ? 'Menguji chat…' : 'Uji via chat'}
                </button>
              </form>
              {activeProvider.chatError && (
                <div className="chat-fallback-error">
                  <AlertTriangle size={14} />
                  <span>{activeProvider.chatError}</span>
                </div>
              )}
              <span className="chat-fallback-note">
                Hanya satu permintaan kecil (maks. 16 token). Jika berhasil, model otomatis
                ditambahkan dan siap diuji.
              </span>
            </div>
          )}
        </section>

        <section className="workspace" id="benchmark">
          <div className="panel model-panel">
            <div className="section-heading compact">
              <span className="step-number">02</span>
              <div>
                <div className="eyebrow small">Pilih peserta</div>
                <h2>Model yang akan diadu</h2>
              </div>
              <span className="selection-count">
                <span>{selectedCount}</span> / {MAX_MODELS}
              </span>
            </div>

            <div className="model-toolbar">
              <label className="search-shell">
                <Search size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama model atau ID…"
                  aria-label="Cari model"
                  disabled={!totalModelCount}
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={selectAllVisible}
                disabled={!visibleEntries.length || phase === 'running'}
              >
                Pilih semua
              </button>
              <button
                type="button"
                className="text-button muted"
                onClick={clearSelection}
                disabled={!selectedCount || phase === 'running'}
              >
                Bersihkan
              </button>
            </div>

            <div className="model-list multi">
              {providers.some((provider) => provider.modelsLoading) ? (
                <div className="model-skeletons" aria-label="Memuat model">
                  {[0, 1, 2, 3, 4].map((key) => (
                    <div className="model-skeleton" key={key}>
                      <span />
                      <div>
                        <span />
                        <span />
                      </div>
                    </div>
                  ))}
                </div>
              ) : totalModelCount ? (
                providers.map((provider) => {
                  if (!provider.models.length) return null;
                  const list = visibleEntries.filter((entry) => entry.provider.id === provider.id);
                  return (
                    <div className="model-group" key={provider.id}>
                      <div className="model-group-head">
                        <span className="provider-dot" />
                        <strong>{provider.label}</strong>
                        <span className="model-group-host">
                          {provider.baseUrl
                            ? hostFromUrl(provider.resolvedBaseUrl || provider.baseUrl)
                            : 'URL belum diisi'}
                        </span>
                        <span className="model-group-count">
                          {provider.selected.length} dipilih
                        </span>
                        {!provider.verified && (
                          <span className="model-group-warn">belum terverifikasi</span>
                        )}
                      </div>
                      {list.length ? (
                        list.map(({ model }) => {
                          const isSelected = provider.selected.includes(model.id);
                          const context = formatContext(model.contextLength);
                          return (
                            <button
                              type="button"
                              className={`model-row ${isSelected ? 'selected' : ''}`}
                              key={modelKey(provider.id, model.id)}
                              onClick={() => toggleModel(provider.id, model.id)}
                              aria-pressed={isSelected}
                              disabled={phase === 'running'}
                            >
                              <span className={`model-check ${isSelected ? 'checked' : ''}`}>
                                {isSelected && <span />}
                              </span>
                              <span className="model-main">
                                <span className="model-title">{model.name || model.id}</span>
                                {model.name !== model.id && (
                                  <span className="model-id">{model.id}</span>
                                )}
                              </span>
                              <span className="model-meta">
                                {model.manual && <span className="meta-tag manual">manual</span>}
                                {context && <span className="meta-tag">{context}</span>}
                                {model.ownedBy && (
                                  <span className="meta-owner">{model.ownedBy}</span>
                                )}
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <span className="model-group-empty">Tidak ada model yang cocok.</span>
                      )}
                    </div>
                  );
                })
              ) : search ? (
                <div className="empty-models compact">
                  <Search size={20} />
                  <strong>Tidak ada model yang cocok</strong>
                  <p>Ubah kata kunci pencarian.</p>
                </div>
              ) : (
                <div className="empty-models">
                  <span className="empty-icon">
                    <Cpu size={24} />
                  </span>
                  <strong>Belum ada model</strong>
                  <p>
                    Isi Base URL provider aktif lalu klik <b>Muat model</b> untuk mengambil daftar
                    model.
                  </p>
                  {activeProvider.modelsError && (
                    <span className="empty-error">{activeProvider.modelsError}</span>
                  )}
                  {!activeProvider.modelsError && !activeProvider.verified && (
                    <span className="empty-hint">
                      <Info size={13} />
                      Anda juga dapat menambahkan ID model secara manual di bawah.
                    </span>
                  )}
                </div>
              )}
            </div>

            {providers.some((provider) => provider.modelsError) && totalModelCount > 0 && (
              <div className="models-error">
                <AlertTriangle size={14} />
                {providers
                  .filter((provider) => provider.modelsError)
                  .map((provider) => `${provider.label}: ${provider.modelsError}`)
                  .join(' · ')}
              </div>
            )}

            <form className="manual-model" onSubmit={addManualModel}>
              <span className="manual-label">
                Tambah manual ke <strong>{activeProvider.label}</strong>
              </span>
              <span className="manual-input">
                <input
                  type="text"
                  value={manualModel}
                  onChange={(event) => setManualModel(event.target.value)}
                  placeholder="mis. gpt-4.1-mini"
                  spellCheck={false}
                  disabled={phase === 'running'}
                  aria-label="ID model manual"
                />
                <button
                  type="submit"
                  className="icon-button add"
                  disabled={!manualModel.trim() || phase === 'running'}
                  aria-label="Tambahkan model"
                >
                  <Plus size={16} />
                </button>
              </span>
            </form>
          </div>

          <div className="panel prompt-panel">
            <div className="section-heading compact">
              <span className="step-number">03</span>
              <div>
                <div className="eyebrow small">Prompt & parameter</div>
                <h2>Uji dengan prompt yang sama</h2>
              </div>
            </div>

            <div className="preset-row">
              <span className="preset-label">
                <WandSparkles size={13} />
                Preset
              </span>
              {PROMPT_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  className="preset-pill"
                  onClick={() => setPrompt(preset.text)}
                  disabled={phase === 'running'}
                  title={preset.text}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="prompt-field">
              <span className="sr-only">Prompt pengujian</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Tulis prompt yang akan dikirim ke semua model…"
                aria-label="Prompt pengujian"
                disabled={phase === 'running'}
                rows={8}
                maxLength={40_000}
              />
              <span className="prompt-meta">
                <span>{prompt.length.toLocaleString('id-ID')} karakter</span>
                <span>Dikirim identik ke semua model</span>
              </span>
            </label>

            <button
              type="button"
              className={`system-toggle ${showSystem ? 'open' : ''}`}
              onClick={() => setShowSystem((visible) => !visible)}
              aria-expanded={showSystem}
              disabled={phase === 'running'}
            >
              <SlidersHorizontal size={14} />
              System prompt
              <span>{showSystem ? 'Sembunyikan' : 'Opsional'}</span>
              <ChevronDown size={14} />
            </button>

            {showSystem && (
              <label className="system-field">
                <span className="sr-only">System prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder="mis. Anda adalah asisten yang menjawab ringkas dan akurat."
                  aria-label="System prompt"
                  disabled={phase === 'running'}
                  rows={3}
                  maxLength={40_000}
                />
              </label>
            )}

            <div className="parameter-grid">
              <label className="parameter">
                <span className="parameter-head">
                  <span>Temperature</span>
                  <strong>{temperature.toFixed(1)}</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  aria-label="Temperature"
                  disabled={phase === 'running'}
                />
                <span className="range-labels">
                  <span>Presisi</span>
                  <span>Kreatif</span>
                </span>
              </label>

              <label className="parameter">
                <span className="parameter-head">
                  <span>Max token output</span>
                </span>
                <span className="number-shell">
                  <input
                    type="number"
                    min="1"
                    max="32768"
                    step="1"
                    value={maxTokens}
                    onChange={(event) =>
                      setMaxTokens(
                        Math.min(32_768, Math.max(1, Number(event.target.value) || 1)),
                      )
                    }
                    aria-label="Max token output"
                    disabled={phase === 'running'}
                  />
                  <span>token</span>
                </span>
                <span className="range-labels">
                  <span>Batas biaya</span>
                  <span>1 – 32.768</span>
                </span>
              </label>
            </div>

            <div className="run-controls">
              <label className="control-block">
                <span className="control-head">
                  <span>
                    <Layers size={13} />
                    Model bersamaan
                  </span>
                  <strong>{concurrency}×</strong>
                </span>
                <input
                  type="range"
                  min="1"
                  max={MAX_CONCURRENCY}
                  step="1"
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                  aria-label="Jumlah model yang diuji bersamaan"
                  disabled={phase === 'running'}
                />
                <span className="control-scale">
                  <span>1 = satu per satu</span>
                  <span>maks {MAX_CONCURRENCY}×</span>
                </span>
                <span className="control-note">
                  Turunkan bila provider membatasi permintaan bersamaan (concurrency).
                </span>
              </label>

              <label className="control-block">
                <span className="control-head">
                  <span>
                    <Repeat size={13} />
                    Ulangi pengujian
                  </span>
                  <strong>{repetitions}×</strong>
                </span>
                <input
                  type="range"
                  min="1"
                  max={MAX_REPETITIONS}
                  step="1"
                  value={repetitions}
                  onChange={(event) => setRepetitions(Number(event.target.value))}
                  aria-label="Jumlah pengulangan per model"
                  disabled={phase === 'running'}
                />
                <span className="control-scale">
                  <span>1 = sekali jalan</span>
                  <span>maks {MAX_REPETITIONS}×</span>
                </span>
                <span className="control-note">
                  Statistik min, median, rata-rata, maks, dan stdev dihitung per model.
                </span>
              </label>
            </div>

            <div className="run-footer">
              <div className="run-hint">
                <Info size={13} />
                <span>{runHint}</span>
              </div>
              {phase === 'running' ? (
                <button type="button" className="button stop run-button" onClick={handleStop}>
                  <Square size={15} fill="currentColor" />
                  Hentikan pengujian
                </button>
              ) : (
                <button
                  type="button"
                  className="button primary run-button"
                  onClick={handleRun}
                  disabled={!canRun}
                >
                  <Play size={16} fill="currentColor" />
                  Jalankan benchmark
                  {runnableCount > 0 && <span className="button-count">{runnableCount}</span>}
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="results-wrap" ref={resultsRef}>
          {phase !== 'idle' && (
            <ResultsPanel
              runs={runs}
              phase={phase}
              completed={completed}
              total={benchTotal}
              wallTotalMs={wallTotalMs}
              runError={runError}
              wasStopped={wasStopped}
              concurrency={runSettings.concurrency}
              repetitions={runSettings.repetitions}
              retries={retryCount}
              onExportCsv={handleExportCsv}
              onExportJson={handleExportJson}
              onExportPng={handleExportPng}
              onRetryFailed={retryFailedModels}
              retryDisabled={phase === 'running'}
            />
          )}
        </div>

        <HistoryPanel
          entries={history}
          onLoad={loadHistoryEntry}
          onDelete={deleteHistoryEntry}
          onClear={clearAllHistory}
          onExportCsv={exportHistoryCsv}
          onExportJson={exportHistoryJson}
        />
      </main>

      <footer className="site-footer">
        <div>
          <span className="footer-brand">FrontStellar Assess</span>
          <span>Dibuat untuk membandingkan model, bukan menebak.</span>
        </div>
        <span className="footer-note">
          <LockKeyhole size={12} />
          Key tidak disimpan · grafik + statistik · multi-provider
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <div className="toast-stack" aria-live="polite">
        {notice && !undo && (
          <div className="toast" role="status">
            <Info size={15} />
            {notice}
          </div>
        )}
        {undo && (
          <div className="toast undo-toast" role="status">
            <Undo2 size={15} />
            <span>{undo.message}</span>
            <button
              type="button"
              className="toast-undo"
              onClick={() => {
                undo.restore();
                setUndo(null);
              }}
            >
              <Undo2 size={13} />
              Urungkan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
