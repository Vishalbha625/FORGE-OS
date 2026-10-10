import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

// ChaiUI theming: dark by default, stored under `chaiui-theme`.
// index.html applies the saved value before first paint.
export type Theme = 'dark' | 'light';
const KEY = 'chaiui-theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff');
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: theme just won't persist */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

/** Half-circle switch with one label for both themes. */
export function ThemeSwitcher() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch theme"
      title="Switch theme"
      className="group grid h-9 w-9 place-items-center rounded-md text-foreground/80 transition-colors hover:text-foreground"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 3a9 9 0 0 1 0 18z"
          fill="currentColor"
          className={`origin-center transition-transform duration-300 motion-reduce:transition-none ${theme === 'light' ? 'rotate-180' : ''}`}
        />
      </svg>
    </button>
  );
}
