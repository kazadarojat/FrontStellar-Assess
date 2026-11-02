import type { ModelInfo } from './types';

export interface StoredProvider {
  label: string;
  baseUrl: string;
  chatModel: string;
  models: ModelInfo[];
  selected: string[];
}

export interface SavedProvider extends StoredProvider {
  id: string;
  name: string;
  savedAt: string;
}

const CURRENT_KEY = 'frontstellar.providers.current';
const ACTIVE_KEY = 'frontstellar.providers.active';
const LEGACY_URLS_KEY = 'frontstellar.providerUrls';
const SAVED_KEY = 'frontstellar.savedProviders';

export const MAX_SAVED_PROVIDERS = 12;

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Penyimpanan bisa penuh atau diblokir; fitur inti tetap berjalan.
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function sanitizeModel(value: unknown): ModelInfo | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const id = asString(entry.id).trim();
  if (!id) return null;
  return {
    id,
    name: asString(entry.name).trim() || id,
    ownedBy: typeof entry.ownedBy === 'string' ? entry.ownedBy : undefined,
    contextLength: typeof entry.contextLength === 'number' ? entry.contextLength : undefined,
    created: typeof entry.created === 'number' ? entry.created : undefined,
    manual: entry.manual === true,
  };
}

function sanitizeModels(value: unknown): ModelInfo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const item of value) {
    const model = sanitizeModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function providerFromValue(value: unknown, index: number): StoredProvider | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const baseUrl = asString(entry.baseUrl).trim();
  if (!baseUrl) return null;

  const models = sanitizeModels(entry.models);
  const selected = sanitizeIds(entry.selected).slice(0, 100);

  // Model terpilih tetap ditampilkan walau metadata lengkapnya tidak tersimpan.
  for (const id of selected) {
    if (!models.some((model) => model.id === id)) {
      models.push({ id, name: id, manual: true });
    }
  }

  return {
    label: asString(entry.label).trim() || `Provider ${index + 1}`,
    baseUrl,
    chatModel: asString(entry.chatModel),
    models,
    selected,
  };
}

/** Provider yang terakhir dipakai (tanpa API key). */
export function loadCurrentProviders(): StoredProvider[] {
  const stored = readJson(CURRENT_KEY);
  if (Array.isArray(stored)) {
    const parsed = stored
      .map((entry, index) => providerFromValue(entry, index))
      .filter((entry): entry is StoredProvider => entry != null)
      .slice(0, 6);
    if (parsed.length) return parsed;
  }

  const legacy = readJson(LEGACY_URLS_KEY);
  if (Array.isArray(legacy)) {
    return legacy
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .slice(0, 6)
      .map((url, index) => ({
        label: `Provider ${index + 1}`,
        baseUrl: url,
        chatModel: '',
        models: [],
        selected: [],
      }));
  }

  return [];
}

/** Indeks tab provider yang terakhir aktif. */
export function loadActiveProviderIndex(): number {
  const value = readJson(ACTIVE_KEY);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Simpan provider aktif agar bisa dilanjutkan setelah reload. API key tidak pernah ikut. */
export function saveCurrentProviders(providers: StoredProvider[], activeIndex = 0): void {
  writeJson(CURRENT_KEY, providers);
  writeJson(ACTIVE_KEY, Math.max(0, Math.trunc(activeIndex)));
  try {
    window.localStorage.setItem(
      LEGACY_URLS_KEY,
      JSON.stringify(providers.map((provider) => provider.baseUrl).filter(Boolean)),
    );
  } catch {
    // Abaikan kegagalan penyimpanan.
  }
}

export function loadSavedProviders(): SavedProvider[] {
  const stored = readJson(SAVED_KEY);
  if (!Array.isArray(stored)) return [];

  return stored
    .map((value) => {
      if (!value || typeof value !== 'object') return null;
      const entry = value as Record<string, unknown>;
      const id = asString(entry.id).trim();
      const base = providerFromValue(entry, 0);
      if (!id || !base) return null;
      return {
        ...base,
        id,
        name: asString(entry.name).trim() || `${base.label} · ${base.baseUrl}`,
        savedAt: asString(entry.savedAt) || new Date(0).toISOString(),
      };
    })
    .filter((entry): entry is SavedProvider => entry != null)
    .slice(0, MAX_SAVED_PROVIDERS);
}

export function saveSavedProviders(providers: SavedProvider[]): void {
  writeJson(SAVED_KEY, providers);
}
