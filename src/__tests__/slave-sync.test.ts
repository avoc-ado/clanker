import { jest } from "@jest/globals";
import { DEFAULT_CONFIG, type ClankerConfig } from "../config.js";
import { getClankerPaths, type ClankerPaths } from "../paths.js";
import type { TaskRecord } from "../state/tasks.js";
import type { WorktreeSyncResult } from "../worktrees.js";

const runGitMock = jest.fn<Promise<string>, [{ args: string[]; cwd: string }]>();
const syncWorktreeMock = jest.fn<
  Promise<WorktreeSyncResult>,
  [{ repoRoot: string; worktreePath: string; fetch?: boolean }]
>();
const getWorktreePathMock = jest.fn<string, [{ repoRoot: string; role: "slave"; index: number }]>();
const appendEventMock = jest.fn<Promise<void>, [{ event: { msg: string } }]>();
const parseWorktreeIndexMock = jest.fn<number | null, [{ podId: string }]>();
const saveTaskMock = jest.fn<Promise<void>, [{ tasksDir: string; task: TaskRecord }]>();

jest.unstable_mockModule("../git.js", () => ({
  runGit: runGitMock,
}));

jest.unstable_mockModule("../worktrees.js", () => ({
  getWorktreePath: getWorktreePathMock,
  syncWorktreeToOriginMain: syncWorktreeMock,
}));

jest.unstable_mockModule("../state/events.js", () => ({
  appendEvent: appendEventMock,
}));

jest.unstable_mockModule("../state/task-commits.js", () => ({
  parseWorktreeIndexFromPodId: parseWorktreeIndexMock,
}));

jest.unstable_mockModule("../state/tasks.js", () => ({
  saveTask: saveTaskMock,
}));

const { syncSlaveWorktreeForPrompt } = await import("../state/slave-sync.js");

const makeConfig = ({ overrides = {} }: { overrides?: Partial<ClankerConfig> }): ClankerConfig => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const makePaths = ({ repoRoot = "/repo" }: { repoRoot?: string } = {}): ClankerPaths =>
  getClankerPaths({ repoRoot });

const makeTask = ({ overrides = {} }: { overrides?: Partial<TaskRecord> }): TaskRecord => ({
  id: "task-1",
  status: "queued",
  assignedSlaveId: "slave-1",
  ...overrides,
});

describe("syncSlaveWorktreeForPrompt", () => {
  beforeEach(() => {
    runGitMock.mockReset();
    syncWorktreeMock.mockReset();
    getWorktreePathMock.mockReset();
    appendEventMock.mockReset();
    parseWorktreeIndexMock.mockReset();
    saveTaskMock.mockReset();
    getWorktreePathMock.mockReturnValue("/repo/.worktrees/slave-1");
  });

  test("skips tasks that are already prompted", async () => {
    const config = makeConfig({});
    const paths = makePaths();

    await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { promptedAt: "2026-01-24T00:00:00.000Z" } }),
    });

    expect(syncWorktreeMock).not.toHaveBeenCalled();
    expect(appendEventMock).not.toHaveBeenCalled();
  });

  test("skips tasks that are not running or queued", async () => {
    const config = makeConfig({});
    const paths = makePaths();

    await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { status: "done" } }),
    });

    expect(syncWorktreeMock).not.toHaveBeenCalled();
  });

  test("skips tasks without assigned slave id", async () => {
    const config = makeConfig({});
    const paths = makePaths();

    await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { assignedSlaveId: undefined } }),
    });

    expect(syncWorktreeMock).not.toHaveBeenCalled();
  });

  test("skips tasks with invalid worktree index", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(null);

    await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({}),
    });

    expect(syncWorktreeMock).not.toHaveBeenCalled();
  });

  test("skips tasks when index exceeds configured slaves", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(2);

    await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({}),
    });

    expect(syncWorktreeMock).not.toHaveBeenCalled();
  });

  test("updates baseMainSha after successful sync", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "1111111";
      }
      if (args[0] === "rev-list") {
        return "1";
      }
      return "";
    });
    syncWorktreeMock.mockResolvedValue({ status: "synced", headSha: "2222222" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { baseMainSha: "1111111" } }),
    });

    expect(result.task.baseMainSha).toBe("2222222");
    expect(result.note).toContain("+1 commit");
    expect(saveTaskMock).toHaveBeenCalled();
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ msg: "slave synced to origin/main" }),
      }),
    );
  });

  test("reports already up to date when no commits ahead", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "1111111";
      }
      if (args[0] === "rev-list") {
        return "0";
      }
      return "";
    });
    syncWorktreeMock.mockResolvedValue({ status: "synced", headSha: "1111111" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { baseMainSha: "1111111" } }),
    });

    expect(result.note).toContain("already up to date");
    expect(saveTaskMock).not.toHaveBeenCalled();
  });

  test("reports sync even when ahead count unavailable", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockResolvedValue("");
    syncWorktreeMock.mockResolvedValue({ status: "synced", headSha: "abcd" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { baseMainSha: "abcd" } }),
    });

    expect(result.note).toContain("head unknown");
    expect(saveTaskMock).not.toHaveBeenCalled();
  });

  test("uses plural commits in synced note when ahead", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "1111111";
      }
      if (args[0] === "rev-list") {
        return "2";
      }
      return "";
    });
    syncWorktreeMock.mockResolvedValue({ status: "synced", headSha: "3333333" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { baseMainSha: "3333333" } }),
    });

    expect(result.note).toContain("+2 commits");
    expect(saveTaskMock).not.toHaveBeenCalled();
  });

  test("reports dirty worktree with behind count", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "1111111";
      }
      if (args[0] === "rev-list") {
        if ((args[2] ?? "").includes("origin/main")) {
          return "3";
        }
        return "0";
      }
      return "";
    });
    syncWorktreeMock.mockResolvedValue({ status: "dirty", headSha: "1111111" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { baseMainSha: "1111111" } }),
    });

    expect(result.note).toContain("dirty worktree");
    expect(result.note).toContain("origin/main ahead by 3 commits");
  });

  test("reports dirty worktree with unknown behind count", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "1111111";
      }
      if (args[0] === "rev-list") {
        return "nope";
      }
      return "";
    });
    syncWorktreeMock.mockResolvedValue({ status: "dirty", headSha: "1111111" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({ overrides: { baseMainSha: "1111111" } }),
    });

    expect(result.note).toContain("origin/main ahead by unknown commits");
  });
  test("reports missing worktree", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockRejectedValue(new Error("missing"));
    syncWorktreeMock.mockResolvedValue({ status: "missing_worktree" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({}),
    });

    expect(result.note).toBe("Sync skipped (missing worktree).");
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ msg: "slave sync skipped; worktree missing" }),
      }),
    );
  });

  test("reports sync failures with message", async () => {
    const config = makeConfig({ overrides: { slaves: 1 } });
    const paths = makePaths();
    parseWorktreeIndexMock.mockReturnValue(1);
    runGitMock.mockImplementation(async ({ args }) => {
      if (args[0] === "rev-parse") {
        return "1111111";
      }
      return "";
    });
    syncWorktreeMock.mockResolvedValue({ status: "sync_failed", message: "fetch failed" });

    const result = await syncSlaveWorktreeForPrompt({
      repoRoot: "/repo",
      paths,
      config,
      task: makeTask({}),
    });

    expect(result.note).toBe("Sync skipped (fetch failed).");
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ msg: "fetch failed" }) }),
    );
  });
});
