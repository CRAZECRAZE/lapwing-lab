import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const backend = 'http://127.0.0.1:5757';

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      '/api': backend,
      '/content': backend,
      '/media': backend,
    },
  },
});
