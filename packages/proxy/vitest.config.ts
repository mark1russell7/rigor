import { defineConfig } from "vitest/config";

// `pnpm test` runs only the tests of the pure parts. The socket tests measure time, so they run only in CI (test:net).
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["src/**/*.net.test.ts"],
  },
});
