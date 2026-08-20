import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/build-operator-renderer.ts'],
    // The default 5s is too tight for this suite under parallel load: several
    // tests are CPU-bound (bcrypt PIN hashing, libheif HEIC decoding) and were
    // timing out non-deterministically — a different test each run, every one
    // passing in isolation.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
    },
  },
});
