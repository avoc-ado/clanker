import { createReadStream, watch } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { listTasks } from "../state/tasks.js";
import { appendEvent } from "../state/events.js";
import type { ClankerEvent } from "../state/events.js";

export const ensureEventsLog = async ({ eventsLog }: { eventsLog: string }): Promise<void> => {
  try {
    await stat(eventsLog);
  } catch {
    await writeFile(eventsLog, "", "utf-8");
  }
};

export const renderEventLine = ({
  raw,
  knownTaskIds,
  writeDividerIfNeeded,
  writeLine,
  formatStreamLine,
}: {
  raw: string;
  knownTaskIds: Set<string>;
  writeDividerIfNeeded: ({ date }: { date: Date }) => void;
  writeLine: (line: string) => void;
  formatStreamLine: ({ event }: { event: ClankerEvent }) => { line: string; date: Date } | null;
}): void => {
  const line = raw.trim();
  if (!line) {
    return;
  }
  try {
    const event = JSON.parse(line) as ClankerEvent;
    if (event.taskId) {
      knownTaskIds.add(event.taskId);
    }
    const formatted = formatStreamLine({ event });
    if (!formatted) {
      return;
    }
    writeDividerIfNeeded({ date: formatted.date });
    writeLine(formatted.line);
  } catch {
    return;
  }
};

export const backfillTaskPackets = async ({
  tasksDir,
  knownTaskIds,
  eventsLog,
}: {
  tasksDir: string;
  knownTaskIds: Set<string>;
  eventsLog: string;
}): Promise<void> => {
  const tasks = await listTasks({ tasksDir });
  for (const task of tasks) {
    if (knownTaskIds.has(task.id)) {
      continue;
    }
    knownTaskIds.add(task.id);
    await appendEvent({
      eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "TASK_PACKET",
        msg: task.title ? `packet issued: ${task.title}` : "packet issued",
        taskId: task.id,
      },
    });
  }
};

export const startEventStream = async ({
  eventsLog,
  streamLimit,
  knownTaskIds,
  writeDividerIfNeeded,
  writeLine,
  formatStreamLine,
  watchFile,
}: {
  eventsLog: string;
  streamLimit: number;
  knownTaskIds: Set<string>;
  writeDividerIfNeeded: ({ date }: { date: Date }) => void;
  writeLine: (line: string) => void;
  formatStreamLine: ({ event }: { event: ClankerEvent }) => { line: string; date: Date } | null;
  watchFile?: (path: string, listener: (eventType: string) => void) => { close: () => void };
}): Promise<(() => void) | null> => {
  await ensureEventsLog({ eventsLog });
  try {
    const raw = await readFile(eventsLog, "utf-8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { taskId?: string };
        if (event.taskId) {
          knownTaskIds.add(event.taskId);
        }
      } catch {
        continue;
      }
    }
    const recent = lines.slice(-streamLimit);
    for (const line of recent) {
      renderEventLine({
        raw: line,
        knownTaskIds,
        writeDividerIfNeeded,
        writeLine,
        formatStreamLine,
      });
    }
  } catch {
    return null;
  }

  let offset = 0;
  try {
    const raw = await readFile(eventsLog, "utf-8");
    offset = Buffer.from(raw).length;
  } catch {
    offset = 0;
  }

  const watchFn = watchFile ?? ((path, listener) => watch(path, listener));
  const watcher = watchFn(eventsLog, async (eventType) => {
    if (eventType !== "change") {
      return;
    }
    try {
      const stats = await stat(eventsLog);
      if (stats.size <= offset) {
        return;
      }
      const stream = createReadStream(eventsLog, { start: offset, end: stats.size - 1 });
      let chunked = "";
      stream.on("data", (chunk) => {
        chunked += chunk.toString();
      });
      stream.on("end", () => {
        const chunkLines = chunked
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        for (const line of chunkLines) {
          renderEventLine({
            raw: line,
            knownTaskIds,
            writeDividerIfNeeded,
            writeLine,
            formatStreamLine,
          });
        }
        offset = stats.size;
      });
    } catch {
      return;
    }
  });

  return () => watcher.close();
};
