import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    globals: true,
    environment: 'node'
  }
});
