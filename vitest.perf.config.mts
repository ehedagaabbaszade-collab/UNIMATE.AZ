import { defineConfig } from "vitest/config";

// `npm run perf`: seeds realistic volumes on PGlite and EXPLAINs the hot paths (see docs/PERFORMANCE.md).
export default defineConfig({
  test: { include: ["tests/perf/**/*.perf.ts"], testTimeout: 600_000, hookTimeout: 600_000 },
});
