const isInWorktree = process.cwd().includes("/.worktree/");
const shouldIgnoreWorktree = process.env.JEST_INCLUDE_WORKTREE !== "1" && !isInWorktree;

module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  testTimeout: 20000,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  modulePathIgnorePatterns: shouldIgnoreWorktree ? ["/\\.worktree/"] : [],
  testMatch: ["<rootDir>/tests/it/**/*.test.ts"],
  collectCoverage: false,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.it.json" }],
  },
};
