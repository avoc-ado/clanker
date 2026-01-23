import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Heartbeat {
  slaveId: string;
  ts: string;
  pid?: number;
  role?: "planner" | "judge" | "slave";
}

export const isHeartbeatStale = ({
  heartbeat,
  nowMs,
  thresholdMs,
}: {
  heartbeat: Heartbeat;
  nowMs: number;
  thresholdMs: number;
}): boolean => {
  const deltaMs = nowMs - new Date(heartbeat.ts).getTime();
  return deltaMs > thresholdMs;
};

export const writeHeartbeat = async ({
  heartbeatDir,
  slaveId,
  pid,
  role,
}: {
  heartbeatDir: string;
  slaveId: string;
  pid?: number;
  role?: Heartbeat["role"];
}): Promise<void> => {
  const payload: Heartbeat = {
    slaveId,
    ts: new Date().toISOString(),
    pid,
    role,
  };
  const path = join(heartbeatDir, `${slaveId}.json`);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
};
