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
}): { mode: RelaunchMode; target: string | null } => {
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
  return { mode, target };
};

export const runRelaunch = async ({
  args,
  log,
}: {
  args: string[];
  log?: (message: string) => void;
}): Promise<void> => {
  const writeLine = log ?? console.log;
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const { mode, target } = parseRelaunchArgs({ args });
  const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
  const nowMs = Date.now();
  const signal = mode === "fresh" ? "SIGUSR1" : "SIGUSR2";
  if (!heartbeats.length) {
    throw new Error("No active heartbeats found");
  }

  const selected = target ? heartbeats.filter((entry) => entry.slaveId === target) : heartbeats;
  if (target && selected.length === 0) {
    const known = heartbeats
      .map((entry) => entry.slaveId)
      .sort()
      .join(", ");
    throw new Error(`Unknown relaunch target ${target}${known ? ` (known: ${known})` : ""}`);
  }

  const failures: string[] = [];
  const skipped: string[] = [];
  let successCount = 0;

  for (const heartbeat of selected) {
    if (!heartbeat.pid) {
      skipped.push(`${heartbeat.slaveId} (missing pid)`);
      continue;
    }
    if (isHeartbeatStale({ heartbeat, nowMs, thresholdMs: STALE_THRESHOLD_MS })) {
      skipped.push(`${heartbeat.slaveId} (stale)`);
      continue;
    }
    try {
      process.kill(heartbeat.pid, signal);
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "CODEX_RELAUNCH_REQUEST",
          msg: `relaunch ${mode}`,
          slaveId: heartbeat.slaveId,
          data: {
            mode,
            pid: heartbeat.pid,
          },
        },
      });
      writeLine(`relaunch signal sent to ${heartbeat.slaveId} (${mode})`);
      successCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${heartbeat.slaveId} (${message})`);
    }
  }

  if (skipped.length > 0) {
    writeLine(`relaunch skipped: ${skipped.join(", ")}`);
  }
  if (failures.length > 0) {
    throw new Error(`Relaunch failed for: ${failures.join(", ")}`);
  }
  if (successCount === 0) {
    throw new Error("No relaunch targets were eligible");
  }
};
