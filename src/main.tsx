import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Ask the browser not to evict IndexedDB under storage pressure: it holds all
// of the athlete's health data. Warn once if the browser says no.
const PERSIST_WARNED_KEY = 'forge-os:persist-warned';
async function requestPersistentStorage(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  try {
    if (await navigator.storage.persisted()) return;
    if (await navigator.storage.persist()) return;
    if (localStorage.getItem(PERSIST_WARNED_KEY)) return;
    localStorage.setItem(PERSIST_WARNED_KEY, '1');
    console.warn('Persistent storage was not granted. The browser may clear data under storage pressure, so export a backup regularly.');
  } catch {
    // Storage APIs can throw in private mode; the app works without persistence.
  }
}
void requestPersistentStorage();
