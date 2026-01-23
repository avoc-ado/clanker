const isInWorktree = process.cwd().includes("/.worktree/");
const shouldIgnoreWorktree = process.env.JEST_INCLUDE_WORKTREE !== "1" && !isInWorktree;

module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  modulePathIgnorePatterns: shouldIgnoreWorktree
    ? ["/\\.worktree/", "/\\.vendor/"]
    : ["/\\.vendor/"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/commands/**",
    "!src/cli.ts",
    "!src/tui/**",
    "!src/tmux.ts",
    "!src/git.ts",
    "!src/worktrees.ts",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/tests/it/",
    "/\\.vendor/",
    ...(shouldIgnoreWorktree ? ["/\\.worktree/"] : []),
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};
