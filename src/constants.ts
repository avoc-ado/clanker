export type RelaunchMode = "fresh" | "resume";

export const RELAUNCH_SIGNALS = {
  fresh: "SIGUSR1",
  resume: "SIGUSR2",
} as const satisfies Record<RelaunchMode, NodeJS.Signals>;

export const HEARTBEAT_STALE_MS = 30_000;
export const TASK_LOCK_TTL_MS = 60_000;
