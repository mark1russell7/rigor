import { defineConfig } from "vitest/config";

// `pnpm test` runs only the tests of the pure parts. The socket tests measure time, so they run only in CI (test:net).
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Each test has a limit of 20 s, in place of the 5 s of vitest. A test with a limit of its own keeps it.
    // On CI, the slowest test with no limit of its own takes 4.4 s, and a slow runner takes twice the time.
    testTimeout: 20_000,
    exclude: ["src/**/*.net.test.ts"],
  },
});
