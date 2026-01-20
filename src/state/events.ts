import { appendFile } from "node:fs/promises";

export interface ClankerEvent {
  ts: string;
  type: string;
  msg: string;
  slaveId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

export const appendEvent = async ({
  eventsLog,
  event,
}: {
  eventsLog: string;
  event: ClankerEvent;
}): Promise<void> => {
  const line = `${JSON.stringify(event)}\n`;
  await appendFile(eventsLog, line, "utf-8");
};
