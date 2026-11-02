export type ThemeMode = 'dark' | 'light';
export type AccentKey = 'lime' | 'cyan' | 'amber';

export interface Preferences {
  theme: ThemeMode;
  accent: AccentKey;
  reducedMotion: boolean;
}

export interface AccentOption {
  key: AccentKey;
  label: string;
  color: string;
}

export const ACCENTS: AccentOption[] = [
  { key: 'lime', label: 'Lime', color: '#c9ff5c' },
  { key: 'cyan', label: 'Cyan', color: '#62d9ff' },
  { key: 'amber', label: 'Amber', color: '#ffb45f' },
];

const STORAGE_KEY = 'frontstellar.preferences';

const DEFAULTS: Preferences = {
  theme: 'dark',
  accent: 'lime',
  reducedMotion: false,
};

export function loadPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      accent: ACCENTS.some((accent) => accent.key === parsed.accent)
        ? (parsed.accent as AccentKey)
        : 'lime',
      reducedMotion: parsed.reducedMotion === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferensi bersifat opsional; abaikan kegagalan penyimpanan.
  }
}

export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.accent = preferences.accent;
  root.dataset.reducedMotion = preferences.reducedMotion ? 'true' : 'false';
}

export function accentColor(accent: AccentKey): string {
  return ACCENTS.find((item) => item.key === accent)?.color ?? ACCENTS[0].color;
}

export function nextAccent(accent: AccentKey): AccentKey {
  const index = ACCENTS.findIndex((item) => item.key === accent);
  return ACCENTS[(index + 1) % ACCENTS.length].key;
}
