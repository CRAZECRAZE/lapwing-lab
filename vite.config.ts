import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import preact from '@preact/preset-vite';

const backend = 'http://127.0.0.1:5757';

// The API server refuses any Host or Origin that is not its own address (see server/guard.ts), and the browser
// sends the Vite address (localhost:5173). changeOrigin rewrites Host to the target's; the proxyReq hook sets
// Origin to the target too. setHeader replaces the browser's own Origin instead of adding a second one,
// which the server would refuse. The server never has to accept the Vite origin.
export function devProxy(target: string): Record<string, ProxyOptions> {
  const entry: ProxyOptions = {
    target,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', target);
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
