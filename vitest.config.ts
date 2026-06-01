import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'setup/**/*.test.ts',
      'skills-engine/**/*.test.ts',
    ],
    // Many skills-engine tests are integration tests that spawn real git/node
    // subprocesses (initGitRepo alone is ~8 spawns; rebase/fetch-upstream do
    // 15-25). On Windows each spawn costs ~150-600ms (process creation + git
    // startup), and vitest's parallel workers contend for CPU, so these
    // legitimately exceed the 5s/10s defaults. Raise the ceilings rather than
    // serialize the suite.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
