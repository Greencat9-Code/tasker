import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { store } from './lib/store';
import './styles.css';

store.init();
if (import.meta.env.DEV) (window as any).__tasker = store;   // dev console access for testing

// no SW inside the native (Capacitor) shell — assets are bundled and notifications are scheduled on-device
if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(e => console.warn('SW registration failed', e));
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
