import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Heartbeat } from "./heartbeat.js";

export const readHeartbeats = async ({ heartbeatDir }: { heartbeatDir: string }): Promise<Heartbeat[]> => {
  try {
    const files = await readdir(heartbeatDir);
    const heartbeats = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          try {
            const raw = await readFile(join(heartbeatDir, file), "utf-8");
            return JSON.parse(raw) as Heartbeat;
          } catch {
            return null;
          }
        }),
    );
    return heartbeats.filter((hb): hb is Heartbeat => hb !== null);
  } catch {
    return [];
  }
};
