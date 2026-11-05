import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The flips of the CPU model test print their figures, so a reader of the log of CI can check them.
    silent: false,
  },
});
