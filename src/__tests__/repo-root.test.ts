import { getRepoRoot } from "../repo-root.js";

describe("getRepoRoot", () => {
  const original = process.env.CLANKER_REPO_ROOT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLANKER_REPO_ROOT;
    } else {
      process.env.CLANKER_REPO_ROOT = original;
    }
  });

  test("falls back to cwd when env is missing", () => {
    delete process.env.CLANKER_REPO_ROOT;
    expect(getRepoRoot()).toBe(process.cwd());
  });

  test("uses CLANKER_REPO_ROOT when set", () => {
    process.env.CLANKER_REPO_ROOT = "/tmp/clanker-root";
    expect(getRepoRoot()).toBe("/tmp/clanker-root");
  });
});
