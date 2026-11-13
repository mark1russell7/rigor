import { defineConfig } from "vitest/config";

// The socket tests of the workflow proxy-net.yml. They use real sockets on the loopback, and some measure time.
export default defineConfig({
  test: {
    include: ["src/**/*.net.test.ts"],
    testTimeout: 15_000,
  },
});
