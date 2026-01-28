import type { ClankerConfig } from "../config.js";
import type { ClankerPaths } from "../paths.js";
import { runGit } from "../git.js";
import { getWorktreePath, syncWorktreeToOriginMain } from "../worktrees.js";
import { appendEvent } from "./events.js";
import { parseWorktreeIndexFromPodId } from "./task-commits.js";
import { saveTask, type TaskRecord } from "./tasks.js";

const resolveHeadSha = async ({
  worktreePath,
}: {
  worktreePath: string;
}): Promise<string | null> => {
  try {
    const sha = await runGit({ args: ["rev-parse", "--verify", "HEAD"], cwd: worktreePath });
    return sha.trim().length > 0 ? sha.trim() : null;
  } catch {
    return null;
  }
};

const countCommitsBetween = async ({
  worktreePath,
  from,
  to,
}: {
  worktreePath: string;
  from: string;
  to: string;
}): Promise<number | null> => {
  try {
    const raw = await runGit({
      args: ["rev-list", "--count", `${from}..${to}`],
      cwd: worktreePath,
    });
    const count = Number(raw.trim());
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
};

const formatSha = ({ sha }: { sha?: string | null }): string =>
  sha && sha.length >= 7 ? sha.slice(0, 7) : "unknown";

const formatAhead = ({ count }: { count: number | null }): string | null => {
  if (count === null) {
    return null;
  }
  if (count === 0) {
    return "already up to date";
  }
  return `+${count} commit${count === 1 ? "" : "s"}`;
};

export const syncSlaveWorktreeForPrompt = async ({
  repoRoot,
  paths,
  config,
  task,
}: {
  repoRoot: string;
  paths: ClankerPaths;
  config: ClankerConfig;
  task: TaskRecord;
}): Promise<{ task: TaskRecord; note?: string }> => {
  if (task.promptedAt) {
    return { task };
  }
  if (task.status !== "running" && task.status !== "queued") {
    return { task };
  }
  const slaveId = task.assignedSlaveId;
  if (!slaveId) {
    return { task };
  }
  const index = parseWorktreeIndexFromPodId({ podId: slaveId });
  if (!index || index > config.slaves) {
    return { task };
  }
  const worktreePath = getWorktreePath({ repoRoot, role: "slave", index });
  const previousHeadSha = await resolveHeadSha({ worktreePath });
  const syncResult = await syncWorktreeToOriginMain({
    repoRoot,
    worktreePath,
    fetch: false,
  });
  const headSha = syncResult.headSha ?? previousHeadSha;
  const advancedBy =
    previousHeadSha && headSha
      ? await countCommitsBetween({ worktreePath, from: previousHeadSha, to: headSha })
      : null;
  const behindBy =
    syncResult.status === "synced" || !previousHeadSha
      ? null
      : await countCommitsBetween({ worktreePath, from: previousHeadSha, to: "origin/main" });
  const headLabel = formatSha({ sha: headSha });
  const aheadLabel = formatAhead({ count: advancedBy });
  let note: string | undefined;
  if (syncResult.status === "synced") {
    const detail = aheadLabel ? `${aheadLabel}; head ${headLabel}` : `head ${headLabel}`;
    note = `Synced to origin/main (${detail}).`;
  } else if (syncResult.status === "dirty") {
    const behindLabel =
      typeof behindBy === "number"
        ? `origin/main ahead by ${behindBy} commit${behindBy === 1 ? "" : "s"}`
        : "origin/main ahead by unknown commits";
    note = `Sync skipped (dirty worktree; ${behindLabel}; head ${headLabel}).`;
  } else if (syncResult.status === "missing_worktree") {
    note = "Sync skipped (missing worktree).";
  } else {
    note = `Sync skipped (${syncResult.message ?? "sync failed"}).`;
  }
  const nextTask =
    syncResult.status === "synced" && headSha && headSha !== task.baseMainSha
      ? { ...task, baseMainSha: headSha }
      : task;
  if (nextTask !== task) {
    await saveTask({ tasksDir: paths.tasksDir, task: nextTask });
  }
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "SLAVE_SYNC",
      msg:
        syncResult.status === "synced"
          ? "slave synced to origin/main"
          : syncResult.status === "dirty"
            ? "slave sync skipped; worktree dirty"
            : syncResult.status === "missing_worktree"
              ? "slave sync skipped; worktree missing"
              : (syncResult.message ?? "slave sync failed"),
      taskId: task.id,
      slaveId,
      data: {
        status: syncResult.status,
        previousHeadSha,
        headSha,
        advancedBy,
        behindBy,
        worktreePath,
        fetch: false,
      },
    },
  });
  return { task: nextTask, note };
};
