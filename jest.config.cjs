module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/commands/**",
    "!src/cli.ts",
    "!src/tui/**",
    "!src/tmux.ts",
    "!src/git.ts",
    "!src/worktrees.ts",
  ],
  testPathIgnorePatterns: ["/dist/", "/tests/it/"],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};
