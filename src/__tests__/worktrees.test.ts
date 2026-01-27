import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";

const runGitMock = jest.fn<Promise<string>, [{ args: string[]; cwd: string }]>();

jest.unstable_mockModule("../git.js", () => ({
  runGit: runGitMock,
}));

const {
  ensureRoleWorktrees,
  getWorktreePath,
  listWorktreeSpecs,
  syncWorktreeToOriginMain,
  commitWorktreeChanges,
  checkoutWorktreeCommit,
} = await import("../worktrees.js");

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

  test("ensureRoleWorktrees tolerates worktree lock races", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "planner", index: 1 });
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "";
      }
      if (args[0] === "worktree") {
        await mkdir(worktreePath, { recursive: true });
        await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
        throw new Error(
          "fatal: Unable to create '/tmp/repo/.git/worktrees/planner-1/index.lock': File exists.",
        );
      }
      return "";
    });
    await expect(
      ensureRoleWorktrees({
        repoRoot: root,
        planners: 1,
        judges: 0,
        slaves: 0,
        ref: "origin/main",
      }),
    ).resolves.toBeDefined();
    const addCalls = runGitMock.mock.calls.filter(([call]) => call.args[0] === "worktree");
    expect(addCalls.length).toBe(1);
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
    ).rejects.toThrow("Clanker needs a GitHub remote named origin with primary branch main.");
  });

  test("syncWorktreeToOriginMain skips dirty worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "planner", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return " M file.ts";
      }
      if (args[0] === "rev-parse") {
        return "sha-dirty";
      }
      return "";
    });
    const result = await syncWorktreeToOriginMain({ repoRoot: root, worktreePath });
    expect(result.status).toBe("dirty");
    expect(result.headSha).toBe("sha-dirty");
    expect(runGitMock.mock.calls.some(([call]) => call.args[0] === "checkout")).toBe(false);
  });

  test("syncWorktreeToOriginMain reports missing worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "planner", index: 1 });
    const result = await syncWorktreeToOriginMain({ repoRoot: root, worktreePath });
    expect(result.status).toBe("missing_worktree");
    expect(runGitMock).not.toHaveBeenCalled();
  });

  test("syncWorktreeToOriginMain checks out origin/main when clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "planner", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "sha-clean";
      }
      return "";
    });
    const result = await syncWorktreeToOriginMain({ repoRoot: root, worktreePath });
    expect(result.status).toBe("synced");
    const checkoutCall = runGitMock.mock.calls.find(([call]) => call.args[0] === "checkout");
    expect(checkoutCall?.[0].args).toEqual(["checkout", "--detach", "origin/main"]);
  });

  test("syncWorktreeToOriginMain surfaces sync failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "planner", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === root && args[0] === "fetch") {
        throw new Error("fetch failed");
      }
      if (cwd === worktreePath && args[0] === "rev-parse") {
        return "sha-after-failure";
      }
      return "";
    });
    const result = await syncWorktreeToOriginMain({ repoRoot: root, worktreePath });
    expect(result.status).toBe("sync_failed");
    expect(result.headSha).toBe("sha-after-failure");
    expect(result.message).toContain("fetch failed");
  });

  test("commitWorktreeChanges captures head sha", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "slave", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return " M file.ts";
      }
      if (args[0] === "rev-parse") {
        return "sha-commit";
      }
      return "";
    });
    const result = await commitWorktreeChanges({ worktreePath, taskId: "t1" });
    expect(result.status).toBe("committed");
    expect(result.headSha).toBe("sha-commit");
  });

  test("commitWorktreeChanges reports missing worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "slave", index: 1 });
    const result = await commitWorktreeChanges({ worktreePath, taskId: "t-missing" });
    expect(result.status).toBe("missing_worktree");
  });

  test("commitWorktreeChanges returns clean when no changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "slave", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return "";
      }
      if (args[0] === "rev-parse") {
        return "sha-clean";
      }
      return "";
    });
    const result = await commitWorktreeChanges({ worktreePath, taskId: "t-clean" });
    expect(result.status).toBe("clean");
    expect(result.headSha).toBe("sha-clean");
  });

  test("commitWorktreeChanges reports commit errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "slave", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return " M file.ts";
      }
      if (args[0] === "commit") {
        throw new Error("commit blew up");
      }
      if (args[0] === "rev-parse") {
        return "sha-after-error";
      }
      return "";
    });
    const result = await commitWorktreeChanges({ worktreePath, taskId: "t-error" });
    expect(result.status).toBe("commit_failed");
    expect(result.headSha).toBe("sha-after-error");
  });

  test("checkoutWorktreeCommit detaches to commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "judge", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "sha-judge";
      }
      return "";
    });
    const result = await checkoutWorktreeCommit({ worktreePath, commitSha: "abc123" });
    expect(result.status).toBe("checked_out");
    const checkoutCall = runGitMock.mock.calls.find(
      ([call]) => call.args[0] === "checkout" && call.args[2] === "abc123",
    );
    expect(checkoutCall).toBeDefined();
  });

  test("checkoutWorktreeCommit reports missing worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "judge", index: 1 });
    const result = await checkoutWorktreeCommit({ worktreePath, commitSha: "abc123" });
    expect(result.status).toBe("missing_worktree");
  });

  test("checkoutWorktreeCommit blocks dirty worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "judge", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return " M file.ts";
      }
      if (args[0] === "rev-parse") {
        return "sha-dirty";
      }
      return "";
    });
    const result = await checkoutWorktreeCommit({ worktreePath, commitSha: "abc123" });
    expect(result.status).toBe("dirty");
    expect(result.headSha).toBe("sha-dirty");
  });

  test("checkoutWorktreeCommit reports checkout errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-worktrees-"));
    const worktreePath = getWorktreePath({ repoRoot: root, role: "judge", index: 1 });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return "";
      }
      if (args[0] === "checkout") {
        throw new Error("checkout failed");
      }
      if (args[0] === "rev-parse") {
        return "sha-after-checkout-fail";
      }
      return "";
    });
    const result = await checkoutWorktreeCommit({ worktreePath, commitSha: "abc123" });
    expect(result.status).toBe("checkout_failed");
    expect(result.headSha).toBe("sha-after-checkout-fail");
    expect(result.message).toContain("checkout failed");
  });
});
