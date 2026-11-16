import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Each test has a limit of 20 s, in place of the 5 s of vitest. A test with a limit of its own keeps it.
    // On CI, the slowest test with no limit of its own takes 4.4 s, and a slow runner takes twice the time.
    testTimeout: 20_000,
    // The flips of the CPU model test print their figures, so a reader of the log of CI can check them.
    silent: false,
  },
});
