import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";

const runGitMock = jest.fn<Promise<string>, [{ args: string[]; cwd: string }]>();

jest.unstable_mockModule("../git.js", () => ({
  runGit: runGitMock,
}));

const { ensureRoleWorktrees, getWorktreePath, listWorktreeSpecs } = await import("../worktrees.js");

describe("worktrees", () => {
  beforeEach(() => {
    runGitMock.mockReset();
    runGitMock.mockResolvedValue("");
  });

  test("listWorktreeSpecs builds role paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const specs = listWorktreeSpecs({ repoRoot: root, planners: 1, judges: 1, slaves: 2 });
    expect(specs.map((spec) => spec.name)).toEqual(["planner-1", "judge-1", "slave-1", "slave-2"]);
    expect(specs[0]?.path).toBe(getWorktreePath({ repoRoot: root, role: "planner", index: 1 }));
  });

  test("ensureRoleWorktrees adds missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    await ensureRoleWorktrees({
      repoRoot: root,
      planners: 1,
      judges: 0,
      slaves: 0,
      ref: "origin/main",
    });
    const addCalls = runGitMock.mock.calls.filter(([call]) => call.args[0] === "worktree");
    expect(addCalls.length).toBe(1);
  });

  test("ensureRoleWorktrees skips existing worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "planner", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    await ensureRoleWorktrees({
      repoRoot: root,
      planners: 1,
      judges: 0,
      slaves: 0,
      ref: "origin/main",
    });
    const addCalls = runGitMock.mock.calls.filter(([call]) => call.args[0] === "worktree");
    expect(addCalls.length).toBe(0);
  });

  test("ensureRoleWorktrees throws when ref missing", async () => {
    runGitMock.mockRejectedValueOnce(new Error("missing ref"));
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    await expect(
      ensureRoleWorktrees({
        repoRoot: root,
        planners: 1,
        judges: 0,
        slaves: 0,
        ref: "origin/main",
      }),
    ).rejects.toThrow("worktree ref origin/main not found");
  });
});
