import { readFile } from "node:fs/promises";
import type { ClankerEvent } from "./events.js";

export const readRecentEvents = async ({
  eventsLog,
  limit,
}: {
  eventsLog: string;
  limit: number;
}): Promise<ClankerEvent[]> => {
  try {
    const raw = await readFile(eventsLog, "utf-8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const recent = lines.slice(-limit);
    return recent
      .map((line) => {
        try {
          return JSON.parse(line) as ClankerEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is ClankerEvent => event !== null);
  } catch {
    return [];
  }
};
