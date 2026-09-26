import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only bridge so `npm run dev` serves the /api functions locally,
 * mirroring how Vercel serves them in production.
 *
 * Put your keys in a local `.env` file first (copy .env.example).
 * Note: if you edit files inside /api while the dev server is running,
 * restart `npm run dev` to pick up the changes.
 */
function localApiBridge() {
  return {
    name: 'local-api-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const name = req.url
          .slice('/api/'.length)
          .split('?')[0]
          .replace(/[^a-zA-Z0-9_-]/g, '');
        try {
          // Resolve from the project root (vite bundles this config file to a
          // temp location, so import.meta.url would point to the wrong place).
          const file = pathToFileURL(path.join(process.cwd(), 'api', `${name}.js`)).href;
          const mod = await import(file);
          // Shim the small part of Vercel's (req, res) API that the handlers use.
          req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
          };
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String((err && err.message) || err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env so ONEMAP_* is available to the local /api bridge during dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), localApiBridge()],
  };
});
