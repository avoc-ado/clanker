module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  modulePathIgnorePatterns: ["/\\.worktree/"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/commands/**",
    "!src/cli.ts",
    "!src/tui/**",
    "!src/tmux.ts",
    "!src/git.ts",
    "!src/worktrees.ts",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/tests/it/", "/\\.worktree/"],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};
