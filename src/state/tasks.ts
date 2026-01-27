import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTaskRecord } from "./task-validate.js";

export type TaskStatus =
  | "queued"
  | "running"
  | "needs_judge"
  | "rework"
  | "done"
  | "blocked"
  | "paused"
  | "failed";

export interface TaskUsage {
  tokens: number;
  cost: number;
  judgeTokens?: number;
  judgeCost?: number;
}

export interface TaskRecord {
  id: string;
  title?: string;
  status: TaskStatus;
  baseMainSha?: string;
  ownerDirs?: string[];
  ownerFiles?: string[];
  assignedSlaveId?: string;
  resumeSlaveId?: string;
  prompt?: string;
  promptedAt?: string;
  slaveCommitSha?: string;
  slaveCommittedAt?: string;
  judgeCheckedOutSha?: string;
  judgeCheckedOutAt?: string;
  usage?: TaskUsage;
}

const isTaskStatus = (value: unknown): value is TaskStatus => {
  return (
    value === "queued" ||
    value === "running" ||
    value === "needs_judge" ||
    value === "rework" ||
    value === "done" ||
    value === "blocked" ||
    value === "paused" ||
    value === "failed"
  );
};

const parseTaskRecord = ({ value }: { value: unknown }): TaskRecord | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<TaskRecord>;
  if (!record.id || typeof record.id !== "string") {
    return null;
  }
  if (!isTaskStatus(record.status)) {
    return null;
  }
  if (record.ownerDirs && !record.ownerDirs.every((dir) => typeof dir === "string")) {
    return null;
  }
  if (record.ownerFiles && !record.ownerFiles.every((file) => typeof file === "string")) {
    return null;
  }
  if (record.resumeSlaveId && typeof record.resumeSlaveId !== "string") {
    return null;
  }
  if (record.slaveCommitSha && typeof record.slaveCommitSha !== "string") {
    return null;
  }
  if (record.slaveCommittedAt && typeof record.slaveCommittedAt !== "string") {
    return null;
  }
  if (record.judgeCheckedOutSha && typeof record.judgeCheckedOutSha !== "string") {
    return null;
  }
  if (record.judgeCheckedOutAt && typeof record.judgeCheckedOutAt !== "string") {
    return null;
  }
  if (record.usage) {
    if (typeof record.usage.tokens !== "number" || typeof record.usage.cost !== "number") {
      return null;
    }
    if (record.usage.judgeTokens && typeof record.usage.judgeTokens !== "number") {
      return null;
    }
    if (record.usage.judgeCost && typeof record.usage.judgeCost !== "number") {
      return null;
    }
  }
  return record as TaskRecord;
};

const readTaskFile = async ({ path }: { path: string }): Promise<TaskRecord | null> => {
  try {
    const raw = await readFile(path, "utf-8");
    return parseTaskRecord({ value: JSON.parse(raw) });
  } catch {
    return null;
  }
};

export const loadTask = async ({
  tasksDir,
  id,
}: {
  tasksDir: string;
  id: string;
}): Promise<TaskRecord | null> => {
  return readTaskFile({ path: join(tasksDir, `${id}.json`) });
};

export const listTasks = async ({ tasksDir }: { tasksDir: string }): Promise<TaskRecord[]> => {
  try {
    const files = await readdir(tasksDir);
    const tasks = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readTaskFile({ path: join(tasksDir, file) })),
    );
    return tasks.filter((task): task is TaskRecord => task !== null);
  } catch {
    return [];
  }
};

export const saveTask = async ({
  tasksDir,
  task,
}: {
  tasksDir: string;
  task: TaskRecord;
}): Promise<void> => {
  if (!parseTaskRecord({ value: task })) {
    throw new Error(`Invalid task record: ${task.id}`);
  }
  const validation = validateTaskRecord({ task });
  if (!validation.isValid) {
    throw new Error(`Invalid task record: ${task.id} (${validation.errors.join(", ")})`);
  }
  const path = join(tasksDir, `${task.id}.json`);
  await writeFile(path, JSON.stringify(task, null, 2), "utf-8");
};
