import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { store } from './lib/store';
import './styles.css';

store.init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(e => console.warn('SW registration failed', e));
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
