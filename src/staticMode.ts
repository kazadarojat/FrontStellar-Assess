/**
 * Mode statis dipakai saat aplikasi di-build untuk GitHub Pages.
 * Di mode ini backend Express tidak tersedia, jadi hanya demo browser yang jalan.
 */
export const IS_STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

/** Base URL palsu untuk provider demo yang dijalankan sepenuhnya di browser. */
export const LOCAL_DEMO_BASE = 'demo://local';

export const STATIC_DEMO_LABEL = 'Demo statis';

export function isLocalDemoProvider(baseUrl: string): boolean {
  return baseUrl.trim().toLowerCase() === LOCAL_DEMO_BASE;
}
