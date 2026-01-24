import { createReadStream, watch } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { formatEventLine } from "../tui/format-event.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import type { ClankerEvent } from "../state/events.js";
import yargs from "yargs";

const stripTags = ({ line }: { line: string }): string => {
  return line.replace(/\{[^}]+\}/g, "");
};

const formatPlain = ({ event }: { event: ClankerEvent }): string => {
  return stripTags({ line: formatEventLine({ event }) });
};

const emitEvents = ({ raw }: { raw: string }): void => {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ClankerEvent;
      process.stdout.write(`${formatPlain({ event })}\n`);
    } catch {
      process.stdout.write(`${line}\n`);
    }
  }
};

export const runTail = async ({ args }: { args: string[] }): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  try {
    await stat(paths.eventsLog);
  } catch {
    await writeFile(paths.eventsLog, "", "utf-8");
  }
  const parsed = yargs(args)
    .option("limit", { type: "number", default: 30 })
    .option("follow", { type: "boolean", default: true })
    .strict()
    .exitProcess(false)
    .parseSync();
  const limit = Number(parsed.limit ?? 30);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("Invalid --limit value");
  }
  const follow = Boolean(parsed.follow);

  let offset = 0;
  try {
    const raw = await readFile(paths.eventsLog, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const slice = lines.slice(-limit).join("\n");
    emitEvents({ raw: slice });
    offset = Buffer.from(raw).length;
  } catch {
    offset = 0;
  }

  if (!follow) {
    return;
  }

  watch(paths.eventsLog, async (eventType) => {
    if (eventType !== "change") {
      return;
    }
    try {
      const stats = await stat(paths.eventsLog);
      if (stats.size <= offset) {
        return;
      }
      const stream = createReadStream(paths.eventsLog, { start: offset, end: stats.size - 1 });
      let chunked = "";
      stream.on("data", (chunk) => {
        chunked += chunk.toString();
      });
      stream.on("end", () => {
        emitEvents({ raw: chunked });
        offset = stats.size;
      });
    } catch {
      return;
    }
  });
};
