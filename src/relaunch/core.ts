import { isHeartbeatStale } from "../state/heartbeat.js";
import type { Heartbeat } from "../state/heartbeat.js";
import type { ClankerEvent } from "../state/events.js";
import type { RelaunchMode } from "../constants.js";

export type RelaunchSkipReason = "missing_pid" | "stale";

export interface RelaunchSkip {
  slaveId: string;
  reason: RelaunchSkipReason;
}

export interface RelaunchSelection {
  eligible: Array<Heartbeat & { pid: number }>;
  skipped: RelaunchSkip[];
  unknownTarget: boolean;
}

export const selectRelaunchTargets = ({
  heartbeats,
  target,
  nowMs,
  staleMs,
}: {
  heartbeats: Heartbeat[];
  target: string | null;
  nowMs: number;
  staleMs: number;
}): RelaunchSelection => {
  const selected = target ? heartbeats.filter((entry) => entry.slaveId === target) : heartbeats;
  if (target && selected.length === 0) {
    return { eligible: [], skipped: [], unknownTarget: true };
  }
  const eligible: Array<Heartbeat & { pid: number }> = [];
  const skipped: RelaunchSkip[] = [];
  for (const heartbeat of selected) {
    if (!heartbeat.pid) {
      skipped.push({ slaveId: heartbeat.slaveId, reason: "missing_pid" });
      continue;
    }
    if (isHeartbeatStale({ heartbeat, nowMs, thresholdMs: staleMs })) {
      skipped.push({ slaveId: heartbeat.slaveId, reason: "stale" });
      continue;
    }
    eligible.push({ ...heartbeat, pid: heartbeat.pid });
  }
  return { eligible, skipped, unknownTarget: false };
};

export const buildRelaunchEvent = ({
  mode,
  heartbeat,
}: {
  mode: RelaunchMode;
  heartbeat: Heartbeat & { pid: number };
}): ClankerEvent => {
  return {
    ts: new Date().toISOString(),
    type: "CODEX_RELAUNCH_REQUEST",
    msg: `relaunch ${mode}`,
    slaveId: heartbeat.slaveId,
    data: {
      mode,
      pid: heartbeat.pid,
    },
  };
};
