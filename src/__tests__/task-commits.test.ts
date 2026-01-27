import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";
import type { ClankerConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadTask, saveTask, type TaskRecord } from "../state/tasks.js";

const runGitMock = jest.fn<Promise<string>, [{ args: string[]; cwd: string }]>();

jest.unstable_mockModule("../git.js", () => ({
  runGit: runGitMock,
}));

const { ensureSlaveCommitForTask, ensureJudgeCheckoutForTask, parseWorktreeIndexFromPodId } =
  await import("../state/task-commits.js");

const baseConfig = {
  planners: 1,
  judges: 1,
  slaves: 1,
  backlog: 1,
  startImmediately: false,
} satisfies ClankerConfig;

describe("task commits", () => {
  beforeEach(() => {
    runGitMock.mockReset();
    runGitMock.mockResolvedValue("");
  });

  test("parseWorktreeIndexFromPodId handles invalid input", () => {
    expect(parseWorktreeIndexFromPodId({ podId: undefined })).toBeNull();
    expect(parseWorktreeIndexFromPodId({ podId: "slave" })).toBeNull();
    expect(parseWorktreeIndexFromPodId({ podId: "slave-0" })).toBeNull();
    expect(parseWorktreeIndexFromPodId({ podId: "slave-2" })).toBe(2);
  });

  test("ensureSlaveCommitForTask records commit sha", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-commit-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const slaveWorktree = join(paths.stateDir, "worktree", "slave-1");
    await mkdir(slaveWorktree, { recursive: true });
    await writeFile(join(slaveWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return " M file.ts";
      }
      if (args[0] === "rev-parse") {
        return "sha-slave";
      }
      return "";
    });
    const task = {
      id: "t1",
      status: "running",
      prompt: "do work",
      assignedSlaveId: "slave-1",
    } satisfies TaskRecord;
    await saveTask({ tasksDir: paths.tasksDir, task });

    await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });

    const updated = await loadTask({ tasksDir: paths.tasksDir, id: task.id });
    expect(updated?.slaveCommitSha).toBe("sha-slave");
  });

  test("ensureSlaveCommitForTask reports missing worktree", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-missing-worktree-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const task = {
      id: "t-missing-worktree",
      status: "running",
      prompt: "do work",
      assignedSlaveId: "slave-1",
    } satisfies TaskRecord;
    const result = await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("missing_worktree");
  });

  test("ensureSlaveCommitForTask records clean head sha", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-clean-head-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const slaveWorktree = join(paths.stateDir, "worktree", "slave-1");
    await mkdir(slaveWorktree, { recursive: true });
    await writeFile(join(slaveWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return "";
      }
      if (args[0] === "rev-parse") {
        return "sha-clean-head";
      }
      return "";
    });
    const task = {
      id: "t-clean-head",
      status: "running",
      prompt: "do work",
      assignedSlaveId: "slave-1",
    } satisfies TaskRecord;
    await saveTask({ tasksDir: paths.tasksDir, task });

    await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });

    const updated = await loadTask({ tasksDir: paths.tasksDir, id: task.id });
    expect(updated?.slaveCommitSha).toBe("sha-clean-head");
  });

  test("ensureSlaveCommitForTask skips update when head unknown", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-unknown-head-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const slaveWorktree = join(paths.stateDir, "worktree", "slave-1");
    await mkdir(slaveWorktree, { recursive: true });
    await writeFile(join(slaveWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return "";
      }
      if (args[0] === "rev-parse") {
        return "";
      }
      return "";
    });
    const task = {
      id: "t-unknown-head",
      status: "running",
      prompt: "do work",
      assignedSlaveId: "slave-1",
    } satisfies TaskRecord;
    await saveTask({ tasksDir: paths.tasksDir, task });

    await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });

    const updated = await loadTask({ tasksDir: paths.tasksDir, id: task.id });
    expect(updated?.slaveCommitSha).toBeUndefined();
  });

  test("ensureJudgeCheckoutForTask records checkout sha", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-checkout-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const judgeWorktree = join(paths.stateDir, "worktree", "judge-1");
    await mkdir(judgeWorktree, { recursive: true });
    await writeFile(join(judgeWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return args[2] ?? "sha-judge";
      }
      return "";
    });
    const task = {
      id: "t2",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: "sha-slave",
    } satisfies TaskRecord;
    await saveTask({ tasksDir: paths.tasksDir, task });

    await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });

    const updated = await loadTask({ tasksDir: paths.tasksDir, id: task.id });
    expect(updated?.judgeCheckedOutSha).toBe("sha-slave");
  });

  test("ensureJudgeCheckoutForTask skips when judges disabled", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-disabled-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const task = {
      id: "t-judge-disabled",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: "sha-slave",
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: { ...baseConfig, judges: 0 },
      task,
    });
    expect(result.status).toBe("skipped");
    expect(runGitMock).not.toHaveBeenCalled();
  });

  test("ensureJudgeCheckoutForTask continues after sync failure", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-sync-fail-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const judgeWorktree = join(paths.stateDir, "worktree", "judge-1");
    await mkdir(judgeWorktree, { recursive: true });
    await writeFile(join(judgeWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    const commitSha = "sha-sync-target";
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === repoRoot && args[0] === "rev-parse") {
        return args[2] ?? commitSha;
      }
      if (cwd === repoRoot && args[0] === "fetch") {
        throw new Error("fetch failed");
      }
      if (cwd === judgeWorktree && args[0] === "status") {
        return "";
      }
      if (cwd === judgeWorktree && args[0] === "rev-parse") {
        return commitSha;
      }
      return "";
    });
    const task = {
      id: "t-sync-fail",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: commitSha,
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("checked_out");
  });

  test("ensureSlaveCommitForTask reports missing assignment", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-missing-assignment-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const task = {
      id: "t3",
      status: "running",
      prompt: "do work",
    } satisfies TaskRecord;
    const result = await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("missing_assignment");
  });

  test("ensureSlaveCommitForTask skips invalid slave index", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-skip-index-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const task = {
      id: "t4",
      status: "running",
      prompt: "do work",
      assignedSlaveId: "slave-9",
    } satisfies TaskRecord;
    const result = await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("skipped");
  });

  test("ensureSlaveCommitForTask blocks on commit failure", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-task-commit-fail-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const slaveWorktree = join(paths.stateDir, "worktree", "slave-1");
    await mkdir(slaveWorktree, { recursive: true });
    await writeFile(join(slaveWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "status") {
        return " M file.ts";
      }
      if (args[0] === "commit") {
        throw new Error("commit error");
      }
      if (args[0] === "rev-parse") {
        return "sha-after-fail";
      }
      return "";
    });
    const task = {
      id: "t5",
      status: "running",
      prompt: "do work",
      assignedSlaveId: "slave-1",
    } satisfies TaskRecord;
    const result = await ensureSlaveCommitForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("commit_failed");
    expect(result.commitSha).toBe("sha-after-fail");
  });

  test("ensureJudgeCheckoutForTask handles missing commit", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-missing-commit-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const task = {
      id: "t6",
      status: "needs_judge",
      prompt: "review",
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("missing_commit");
  });

  test("ensureJudgeCheckoutForTask handles missing local commit", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-missing-local-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === repoRoot && args[0] === "rev-parse") {
        throw new Error("unknown revision");
      }
      return "";
    });
    const task = {
      id: "t7",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: "sha-missing",
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("commit_missing_locally");
  });

  test("ensureJudgeCheckoutForTask handles missing judge worktree", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-missing-worktree-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === repoRoot && args[0] === "rev-parse") {
        return args[2] ?? "sha";
      }
      return "";
    });
    const task = {
      id: "t8",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: "sha-present",
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("missing_worktree");
  });

  test("ensureJudgeCheckoutForTask handles dirty judge worktree", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-dirty-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const judgeWorktree = join(paths.stateDir, "worktree", "judge-1");
    await mkdir(judgeWorktree, { recursive: true });
    await writeFile(join(judgeWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === repoRoot && args[0] === "rev-parse") {
        return args[2] ?? "sha";
      }
      if (cwd === judgeWorktree && args[0] === "status") {
        return " M file.ts";
      }
      if (cwd === judgeWorktree && args[0] === "rev-parse") {
        return "sha-head";
      }
      return "";
    });
    const task = {
      id: "t9",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: "sha-present",
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("dirty");
  });

  test("ensureJudgeCheckoutForTask handles checkout failure", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-checkout-fail-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const judgeWorktree = join(paths.stateDir, "worktree", "judge-1");
    await mkdir(judgeWorktree, { recursive: true });
    await writeFile(join(judgeWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    const commitSha = "sha-target";
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === repoRoot && args[0] === "rev-parse") {
        return args[2] ?? commitSha;
      }
      if (cwd === judgeWorktree && args[0] === "status") {
        return "";
      }
      if (cwd === judgeWorktree && args[0] === "checkout" && args[2] === commitSha) {
        throw new Error("checkout failed");
      }
      if (cwd === judgeWorktree && args[0] === "rev-parse") {
        return "sha-head";
      }
      return "";
    });
    const task = {
      id: "t10",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: commitSha,
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("checkout_failed");
  });

  test("ensureJudgeCheckoutForTask stops when checkout sees dirty worktree", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "clanker-judge-dirty-checkout-"));
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    const judgeWorktree = join(paths.stateDir, "worktree", "judge-1");
    await mkdir(judgeWorktree, { recursive: true });
    await writeFile(join(judgeWorktree, ".git"), "gitdir: /tmp/fake", "utf-8");
    const commitSha = "sha-dirty-checkout";
    let statusCalls = 0;
    runGitMock.mockImplementation(async ({ args, cwd }) => {
      if (cwd === repoRoot && args[0] === "rev-parse") {
        return args[2] ?? commitSha;
      }
      if (cwd === judgeWorktree && args[0] === "status") {
        statusCalls += 1;
        return statusCalls === 1 ? "" : " M file.ts";
      }
      if (cwd === judgeWorktree && args[0] === "rev-parse") {
        return "sha-head-dirty";
      }
      return "";
    });
    const task = {
      id: "t-dirty-checkout",
      status: "needs_judge",
      prompt: "review",
      slaveCommitSha: commitSha,
    } satisfies TaskRecord;
    const result = await ensureJudgeCheckoutForTask({
      repoRoot,
      paths,
      config: baseConfig,
      task,
    });
    expect(result.status).toBe("dirty");
    expect(result.worktreePath).toBe(judgeWorktree);
  });
});
