/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the coach server when it runs on another domain (e.g. Render). Empty = same origin. */
  readonly VITE_COACH_URL?: string;
  /** Supabase project URL (community only). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key: public by design, access is enforced by RLS. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json version, set at build time (vite.config.ts). */
declare const __APP_VERSION__: string;
