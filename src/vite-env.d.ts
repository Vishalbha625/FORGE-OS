/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the coach server when it runs on another domain (e.g. Render). Empty = same origin. */
  readonly VITE_COACH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
