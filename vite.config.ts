import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import preact from '@preact/preset-vite';

const backend = 'http://127.0.0.1:5757';

// The API server refuses any Host or Origin that is not its own address (see server/guard.ts), and the browser
// sends the Vite address (localhost:5173). changeOrigin rewrites Host to the target's. Origin is rewritten to the
// target only when the browser sent none or sent the Vite page's own origin (Vite has already checked that Host);
// a foreign Origin passes through untouched so the server still refuses it. setHeader replaces the value instead of
// adding a second Origin header, which the server would refuse. The server never has to accept the Vite origin.
export function devProxy(target: string): Record<string, ProxyOptions> {
  const entry: ProxyOptions = {
    target,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        const origin = req.headers.origin;
        if (origin === undefined || origin.toLowerCase() === `http://${req.headers.host}`.toLowerCase()) {
          proxyReq.setHeader('origin', target);
        }
      });
    },
  };
  return { '/api': entry, '/content': entry, '/media': entry };
}

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: devProxy(backend),
  },
});
