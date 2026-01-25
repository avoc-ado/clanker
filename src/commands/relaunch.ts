import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { HEARTBEAT_STALE_MS, RELAUNCH_SIGNALS, type RelaunchMode } from "../constants.js";
import yargs from "yargs";
import { buildRelaunchEvent, selectRelaunchTargets } from "../relaunch/core.js";

const resolveRelaunchMode = ({ args }: { args: string[] }): RelaunchMode => {
  let mode: RelaunchMode = "resume";
  for (const arg of args) {
    if (arg === "--fresh") {
      mode = "fresh";
      continue;
    }
    if (arg === "--resume") {
      mode = "resume";
    }
  }
  return mode;
};

export const normalizeRelaunchTarget = ({ target }: { target: string }): string => {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Missing relaunch target");
  }
  if (/^slave-\d+$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `slave-${trimmed}`;
  }
  if (trimmed === "planner") {
    return "planner-1";
  }
  if (trimmed === "judge") {
    return "judge-1";
  }
  return trimmed;
};

export const parseRelaunchArgs = ({
  args,
}: {
  args: string[];
}): { mode: RelaunchMode; target: string | null } => {
  const parsed = yargs(args)
    .option("fresh", { type: "boolean", default: false })
    .option("resume", { type: "boolean", default: false })
    .strictOptions()
    .exitProcess(false)
    .fail((message: string, error?: Error) => {
      if (message.includes("Unknown argument")) {
        const suffix = message.split(":").slice(1).join(":").trim();
        throw new Error(`Unknown option ${suffix || "(unknown)"}`.trim());
      }
      throw error ?? new Error(message);
    })
    .parseSync();
  const rawTargets = parsed._ as unknown[];
  const targets = rawTargets.map((value) => String(value));
  if (targets.length > 1) {
    throw new Error("Multiple targets provided");
  }
  const target = targets[0] ? normalizeRelaunchTarget({ target: targets[0] }) : null;
  const mode = resolveRelaunchMode({ args });
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
  const signal = RELAUNCH_SIGNALS[mode];
  if (!heartbeats.length) {
    throw new Error("No active heartbeats found");
  }

  const selection = selectRelaunchTargets({
    heartbeats,
    target,
    nowMs,
    staleMs: HEARTBEAT_STALE_MS,
  });
  if (selection.unknownTarget) {
    const known = heartbeats
      .map((entry) => entry.slaveId)
      .sort()
      .join(", ");
    throw new Error(`Unknown relaunch target ${target}${known ? ` (known: ${known})` : ""}`);
  }

  const failures: string[] = [];
  const skipped: string[] = [];
  let successCount = 0;

  for (const skip of selection.skipped) {
    skipped.push(`${skip.slaveId} (${skip.reason.replace("_", " ")})`);
  }

  for (const heartbeat of selection.eligible) {
    try {
      process.kill(heartbeat.pid, signal);
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: buildRelaunchEvent({ mode, heartbeat }),
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
