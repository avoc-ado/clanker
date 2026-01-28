export type RelaunchMode = "fresh" | "resume";

export const RELAUNCH_SIGNALS = {
  fresh: "SIGUSR1",
  resume: "SIGUSR2",
} as const satisfies Record<RelaunchMode, NodeJS.Signals>;

export const HEARTBEAT_STALE_MS = 30_000;
export const TASK_LOCK_TTL_MS = 60_000;
export const JUDGE_PROMPT_STALE_MS = 60_000;
export const SLAVE_PROMPT_STALE_MS = 30_000;
export const IPC_TIMEOUT_MS = 5_000;
export const IPC_DOWN_CACHE_MS = 5_000;
export const IPC_SPOOL_GRACE_MS = 2_000;
export const IPC_SPOOL_BATCH_MAX = 200;
export const IPC_SPOOL_MAX_BYTES = 1_000_000;
