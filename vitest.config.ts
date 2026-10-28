import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      setupFiles: ['./tests/setup/preact-flush.ts'],
      execArgv: ['--import', './tests/setup/raf-shim.ts'],
    },
  }),
);
