export const TASK_SCHEMA = {
  required: ["id", "status", "prompt"],
  status: ["queued", "running", "needs_judge", "rework", "done", "blocked", "paused", "failed"],
  optional: [
    "ownerDirs",
    "ownerFiles",
    "baseMainSha",
    "assignedSlaveId",
    "resumeSlaveId",
    "slaveCommitSha",
    "slaveCommittedAt",
    "judgeCheckedOutSha",
    "judgeCheckedOutAt",
    "usage",
  ],
};

export const formatTaskSchema = (): string => {
  return [
    "Task JSON schema:",
    "- id: string (unique)",
    `- status: one of ${TASK_SCHEMA.status.join(", ")}`,
    "- prompt: string (instructions for slave)",
    "- ownerDirs?: string[]",
    "- ownerFiles?: string[]",
    "- baseMainSha?: string",
    "- assignedSlaveId?: string",
    "- resumeSlaveId?: string",
    "- slaveCommitSha?: string",
    "- slaveCommittedAt?: string",
    "- judgeCheckedOutSha?: string",
    "- judgeCheckedOutAt?: string",
    "- usage?: { tokens: number; cost: number; judgeTokens?: number; judgeCost?: number }",
  ].join("\n");
};
