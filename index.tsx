import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';

const STORAGE_KEYS_TO_PRUNE = [
  'monosphere-project-v3',
  'monosphere-project-v2',
  'monosphere-presets-v1',
  'monosphere-preset-sequence-v1',
] as const;
const MAX_LOCAL_STORAGE_PAYLOAD_CHARS = 4_000_000;

function pruneOversizedStoragePayloads() {
  if (typeof window === 'undefined') return;

  for (const key of STORAGE_KEYS_TO_PRUNE) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw && raw.length > MAX_LOCAL_STORAGE_PAYLOAD_CHARS) {
        console.warn(`Removing oversized localStorage payload for ${key}.`);
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Failed to inspect ${key}:`, error);
    }
  }
}

pruneOversizedStoragePayloads();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
