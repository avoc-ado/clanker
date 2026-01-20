import type { TaskRecord, TaskStatus } from "./tasks.js";

const TASK_STATUSES: TaskStatus[] = [
  "queued",
  "running",
  "needs_judge",
  "rework",
  "done",
  "blocked",
  "paused",
  "handoff_fix",
  "failed",
];

export interface TaskValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

const isStatus = (value: string): value is TaskStatus =>
  TASK_STATUSES.includes(value as TaskStatus);

export const validateTaskRecord = ({ task }: { task: TaskRecord }): TaskValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!task.id || task.id.length === 0) {
    errors.push("missing id");
  }
  if (!task.prompt || task.prompt.length === 0) {
    errors.push("missing prompt");
  }
  if (!task.status || !isStatus(task.status)) {
    errors.push("invalid status");
  }
  if (task.ownerDirs && !task.ownerDirs.every((dir) => dir.length > 0)) {
    errors.push("invalid ownerDirs");
  }
  if (task.ownerFiles && !task.ownerFiles.every((file) => file.length > 0)) {
    errors.push("invalid ownerFiles");
  }
  if (task.resumeSlaveId && task.resumeSlaveId.length === 0) {
    errors.push("invalid resumeSlaveId");
  }
  if (
    (!task.ownerDirs || task.ownerDirs.length === 0) &&
    (!task.ownerFiles || task.ownerFiles.length === 0)
  ) {
    warnings.push("missing ownerDirs");
  }
  if (!task.baseMainSha || task.baseMainSha.length === 0) {
    warnings.push("missing baseMainSha");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  } satisfies TaskValidationResult;
};
