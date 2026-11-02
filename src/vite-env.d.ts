/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" saat build untuk hosting statis (GitHub Pages). */
  readonly VITE_STATIC_DEMO?: string;
  /** Base path build, mis. "/FrontStellar-Assess/". */
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
