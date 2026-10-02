import { defineConfig } from 'vite';
import { handleApi } from './server/extract.js';

// Mounts the same /api routes as server/index.js on the dev server, so
// `npm run dev` is a single process.
const api = {
  name: 'leakproof-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/')) return next();
      const handled = await handleApi(req, res);
      if (handled === false) next();
    });
  },
};

export default defineConfig({
  plugins: [api],
});
