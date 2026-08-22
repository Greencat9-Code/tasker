import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/tasker/',
  plugins: [react()],
  server: { port: 5151, host: '127.0.0.1' },
  build: { sourcemap: false },
});
