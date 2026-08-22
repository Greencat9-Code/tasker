import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';

// Dev only: serve dev/seed.json (written by tools/seed.mjs) so the "Load dev seed.json" button works
// without ever shipping the file in a build.
const devSeed: Plugin = {
  name: 'tasker-dev-seed',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] === '/tasker/seed.json' && existsSync('dev/seed.json')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync('dev/seed.json'));
      } else next();
    });
  },
};

export default defineConfig({
  base: '/tasker/',
  plugins: [react(), devSeed],
  server: { port: 5151, host: '127.0.0.1' },
  build: { sourcemap: false },
});
