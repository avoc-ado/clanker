import type { ClankerConfig } from "../config.js";
import type { ClankerPaths } from "../paths.js";
import { appendEvent } from "./events.js";
import { saveTask, type TaskRecord } from "./tasks.js";
import { runGit } from "../git.js";
import {
  checkoutWorktreeCommit,
  commitWorktreeChanges,
  getWorktreePath,
  syncWorktreeToOriginMain,
} from "../worktrees.js";

export const parseWorktreeIndexFromPodId = ({ podId }: { podId?: string }): number | null => {
  if (!podId) {
    return null;
  }
  const match = /-(\d+)$/.exec(podId.trim());
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const hasCommitLocally = async ({
  repoRoot,
  commitSha,
}: {
  repoRoot: string;
  commitSha: string;
}): Promise<boolean> => {
  try {
    await runGit({ args: ["rev-parse", "--verify", commitSha], cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
};

export interface SlaveCommitResult {
  status:
    | "skipped"
    | "missing_worktree"
    | "clean"
    | "committed"
    | "commit_failed"
    | "missing_assignment";
  commitSha?: string | null;
  message?: string;
  worktreePath?: string;
}

export const ensureSlaveCommitForTask = async ({
  repoRoot,
  paths,
  config,
  task,
}: {
  repoRoot: string;
  paths: ClankerPaths;
  config: ClankerConfig;
  task: TaskRecord;
}): Promise<SlaveCommitResult> => {
  const assignedSlaveId = task.assignedSlaveId;
  if (!assignedSlaveId) {
    return { status: "missing_assignment" };
  }
  const index = parseWorktreeIndexFromPodId({ podId: assignedSlaveId });
  if (!index || index > config.slaves) {
    return { status: "skipped" };
  }
  const worktreePath = getWorktreePath({ repoRoot, role: "slave", index });
  const commitResult = await commitWorktreeChanges({
    worktreePath,
    taskId: task.id,
    taskTitle: task.title,
  });
  if (commitResult.status === "missing_worktree") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "TASK_COMMIT_SKIPPED",
        msg: "missing slave worktree for commit",
        taskId: task.id,
        slaveId: assignedSlaveId,
      },
    });
    return { status: "missing_worktree", worktreePath };
  }
  if (commitResult.status === "commit_failed") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "TASK_COMMIT_FAILED",
        msg: commitResult.message ?? "commit failed",
        taskId: task.id,
        slaveId: assignedSlaveId,
        data: { worktreePath },
      },
    });
    return {
      status: "commit_failed",
      commitSha: commitResult.headSha,
      message: commitResult.message,
      worktreePath,
    };
  }
  const commitSha = commitResult.headSha ?? null;
  if (commitSha) {
    const committedAt = new Date().toISOString();
    const nextTask = {
      ...task,
      slaveCommitSha: commitSha,
      slaveCommittedAt: committedAt,
    };
    await saveTask({ tasksDir: paths.tasksDir, task: nextTask });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: committedAt,
        type: "TASK_COMMITTED",
        msg: commitResult.status === "committed" ? "slave commit captured" : "slave clean at head",
        taskId: task.id,
        slaveId: assignedSlaveId,
        data: { commitSha, worktreePath },
      },
    });
  }
  return {
    status: commitResult.status,
    commitSha,
    worktreePath,
  };
};

export interface JudgeCheckoutResult {
  status:
    | "skipped"
    | "missing_commit"
    | "missing_worktree"
    | "dirty"
    | "commit_missing_locally"
    | "checked_out"
    | "checkout_failed";
  commitSha?: string;
  worktreePath?: string;
  message?: string;
}

const formatJudgeSyncMessage = ({
  status,
  commitSha,
}: {
  status: JudgeCheckoutResult["status"];
  commitSha?: string;
}): string => {
  switch (status) {
    case "missing_commit":
      return "missing slave commit; judge should request rework";
    case "missing_worktree":
      return "missing judge worktree";
    case "dirty":
      return "judge worktree dirty; manual cleanup required";
    case "commit_missing_locally":
      return commitSha ? `commit ${commitSha} not found locally` : "commit not found locally";
    case "checkout_failed":
      return "judge checkout failed";
    case "checked_out":
      return commitSha ? `judge checked out ${commitSha}` : "judge checked out commit";
    default:
      return "judge checkout skipped";
  }
};

export const ensureJudgeCheckoutForTask = async ({
  repoRoot,
  paths,
  config,
  task,
}: {
  repoRoot: string;
  paths: ClankerPaths;
  config: ClankerConfig;
  task: TaskRecord;
}): Promise<JudgeCheckoutResult> => {
  if (config.judges < 1) {
    return { status: "skipped" };
  }
  const commitSha = task.slaveCommitSha?.trim();
  if (!commitSha) {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "JUDGE_CHECKOUT_SKIPPED",
        msg: formatJudgeSyncMessage({ status: "missing_commit" }),
        taskId: task.id,
      },
    });
    return { status: "missing_commit" };
  }
  const commitExists = await hasCommitLocally({ repoRoot, commitSha });
  if (!commitExists) {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "JUDGE_CHECKOUT_FAILED",
        msg: formatJudgeSyncMessage({ status: "commit_missing_locally", commitSha }),
        taskId: task.id,
        data: { commitSha },
      },
    });
    return { status: "commit_missing_locally", commitSha };
  }
  const judgeIndex = 1;
  const worktreePath = getWorktreePath({
    repoRoot,
    role: "judge",
    index: judgeIndex,
  });
  const syncResult = await syncWorktreeToOriginMain({ repoRoot, worktreePath });
  if (syncResult.status === "missing_worktree") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "JUDGE_CHECKOUT_SKIPPED",
        msg: formatJudgeSyncMessage({ status: "missing_worktree" }),
        taskId: task.id,
        data: { worktreePath },
      },
    });
    return { status: "missing_worktree", commitSha, worktreePath };
  }
  if (syncResult.status === "dirty") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "JUDGE_CHECKOUT_SKIPPED",
        msg: formatJudgeSyncMessage({ status: "dirty" }),
        taskId: task.id,
        data: { worktreePath, headSha: syncResult.headSha },
      },
    });
    return { status: "dirty", commitSha, worktreePath };
  }
  if (syncResult.status === "sync_failed") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "JUDGE_CHECKOUT_FAILED",
        msg: syncResult.message ?? "judge sync failed",
        taskId: task.id,
        data: { worktreePath },
      },
    });
  }
  const checkoutResult = await checkoutWorktreeCommit({ worktreePath, commitSha });
  if (checkoutResult.status !== "checked_out") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type:
          checkoutResult.status === "dirty" ? "JUDGE_CHECKOUT_SKIPPED" : "JUDGE_CHECKOUT_FAILED",
        msg: formatJudgeSyncMessage({
          status: checkoutResult.status === "dirty" ? "dirty" : "checkout_failed",
          commitSha,
        }),
        taskId: task.id,
        data: { worktreePath, message: checkoutResult.message },
      },
    });
    return {
      status: checkoutResult.status === "dirty" ? "dirty" : "checkout_failed",
      commitSha,
      worktreePath,
      message: checkoutResult.message,
    };
  }
  const checkedOutAt = new Date().toISOString();
  const nextTask = {
    ...task,
    judgeCheckedOutSha: commitSha,
    judgeCheckedOutAt: checkedOutAt,
  };
  await saveTask({ tasksDir: paths.tasksDir, task: nextTask });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: checkedOutAt,
      type: "JUDGE_CHECKOUT",
      msg: formatJudgeSyncMessage({ status: "checked_out", commitSha }),
      taskId: task.id,
      data: { worktreePath, headSha: checkoutResult.headSha },
    },
  });
  return { status: "checked_out", commitSha, worktreePath };
};
