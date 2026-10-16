import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { ThemeProvider } from '../../store/theme';
import { ToastProvider } from '../../store/toast';
import { ConfirmProvider } from '../../store/confirm';
import { AuthProvider } from '../../store/AuthContext';
import { LogProvider } from '../../features/logging/QuickLog';
import { loadAppData, makeSnapshot, rebuildPlan } from '../../store/appData';
import type { AppState } from '../../store/AppContext';
import { deleteRecord, exportAll, importAll, putRecord, wipeAll } from '../../db/database';
import type { StoreName } from '../../db/types';

// The app's state as AppProvider builds it, read from IndexedDB with the
// same loader, so pages render exactly what is stored on the device. Tests
// mock useApp() to return currentApp(); it lives on globalThis because
// vi.mock factories run before imports.

const HOLDER = globalThis as { __forgeApp?: AppState };
export const currentApp = (): AppState => {
  if (!HOLDER.__forgeApp) throw new Error('Call loadState() first.');
  return HOLDER.__forgeApp;
};

/** Reads IndexedDB the way the app does and makes it the current state. */
export async function loadState(): Promise<AppState> {
  const loaded = await loadAppData();
  const state: AppState = {
    loading: false,
    ...loaded,
    snapshot: makeSnapshot(loaded.profile, loaded.data, loaded.today),
    saveProfile: async (p) => {
      await putRecord('profile', p);
    },
    saveSettings: async (s) => {
      await putRecord('settings', s);
    },
    save: async (store, rec) => {
      await putRecord(store as StoreName, rec as never);
      return rec;
    },
    remove: (store, id) => deleteRecord(store as StoreName, id),
    regeneratePlan: rebuildPlan,
    reload: async () => {
      await loadState();
    },
    exportData: exportAll,
    importData: importAll,
    resetAll: wipeAll,
  };
  HOLDER.__forgeApp = state;
  return state;
}

/** Server-renders a page inside the app's providers, at a route. */
export function renderPage(Page: ComponentType, path = '/'): string {
  return renderToStaticMarkup(
    <StaticRouter location={path}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <LogProvider>
                <Page />
              </LogProvider>
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </StaticRouter>,
  );
}

/** Visible text of rendered markup, tags removed and spaces collapsed. */
export const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
