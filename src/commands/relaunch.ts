import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import { isHeartbeatStale } from "../state/heartbeat.js";
import { readHeartbeats } from "../state/read-heartbeats.js";

const STALE_THRESHOLD_MS = 30_000;

export type RelaunchMode = "fresh" | "resume";

export const normalizeRelaunchTarget = ({ target }: { target: string }): string => {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Missing relaunch target");
  }
  if (/^c\d+$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `c${trimmed}`;
  }
  return trimmed;
};

export const parseRelaunchArgs = ({
  args,
}: {
  args: string[];
}): { mode: RelaunchMode; target: string } => {
  let mode: RelaunchMode = "resume";
  let target: string | null = null;
  for (const arg of args) {
    if (arg === "--fresh") {
      mode = "fresh";
      continue;
    }
    if (arg === "--resume") {
      mode = "resume";
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}`);
    }
    if (target) {
      throw new Error("Multiple targets provided");
    }
    target = normalizeRelaunchTarget({ target: arg });
  }
  if (!target) {
    throw new Error("Missing relaunch target");
  }
  return { mode, target };
};

export const runRelaunch = async ({ args }: { args: string[] }): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const { mode, target } = parseRelaunchArgs({ args });
  const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
  const heartbeat = heartbeats.find((entry) => entry.slaveId === target);
  if (!heartbeat) {
    const known = heartbeats
      .map((entry) => entry.slaveId)
      .sort()
      .join(", ");
    throw new Error(`Unknown relaunch target ${target}${known ? ` (known: ${known})` : ""}`);
  }
  if (!heartbeat.pid) {
    throw new Error(`Heartbeat missing pid for ${target}`);
  }
  const nowMs = Date.now();
  if (isHeartbeatStale({ heartbeat, nowMs, thresholdMs: STALE_THRESHOLD_MS })) {
    throw new Error(`Heartbeat for ${target} is stale`);
  }
  const signal = mode === "fresh" ? "SIGUSR1" : "SIGUSR2";
  try {
    process.kill(heartbeat.pid, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to signal ${target} (${signal}): ${message}`);
  }
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "CODEX_RELAUNCH_REQUEST",
      msg: `relaunch ${mode}`,
      slaveId: target,
      data: {
        mode,
        pid: heartbeat.pid,
      },
    },
  });
  console.log(`relaunch signal sent to ${target} (${mode})`);
};
