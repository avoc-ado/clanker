import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Heartbeat {
  slaveId: string;
  ts: string;
}

export const writeHeartbeat = async ({
  heartbeatDir,
  slaveId,
}: {
  heartbeatDir: string;
  slaveId: string;
}): Promise<void> => {
  const payload: Heartbeat = {
    slaveId,
    ts: new Date().toISOString(),
  };
  const path = join(heartbeatDir, `${slaveId}.json`);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
};
