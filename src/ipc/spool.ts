import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ClankerPaths } from "../paths.js";
import type { IpcHandlers } from "./server.js";
import { IPC_SPOOL_BATCH_MAX, IPC_SPOOL_MAX_BYTES } from "../constants.js";

export interface IpcSpoolEntry {
  ts: string;
  type: string;
  payload: unknown;
}

const getSpoolPath = ({ paths }: { paths: ClankerPaths }): string =>
  join(paths.stateDir, "ipc-spool.ndjson");

const enforceSpoolLimit = async ({
  spoolPath,
  maxBytes,
}: {
  spoolPath: string;
  maxBytes: number;
}): Promise<void> => {
  const info = await stat(spoolPath).catch(() => null);
  if (!info || info.size <= maxBytes) {
    return;
  }
  const raw = await readFile(spoolPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return;
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  let size = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    size += Buffer.byteLength(line) + 1;
    if (size > maxBytes) {
      break;
    }
    kept.unshift(line);
  }
  await writeFile(spoolPath, kept.length ? `${kept.join("\n")}\n` : "", "utf-8");
};

export const appendIpcSpoolEntry = async ({
  paths,
  entry,
}: {
  paths: ClankerPaths;
  entry: IpcSpoolEntry;
}): Promise<void> => {
  const spoolPath = getSpoolPath({ paths });
  await mkdir(dirname(spoolPath), { recursive: true });
  await appendFile(spoolPath, `${JSON.stringify(entry)}\n`, "utf-8");
  await enforceSpoolLimit({ spoolPath, maxBytes: IPC_SPOOL_MAX_BYTES });
};

export const drainIpcSpool = async ({
  paths,
  handlers,
  maxEntries = IPC_SPOOL_BATCH_MAX,
}: {
  paths: ClankerPaths;
  handlers: IpcHandlers;
  maxEntries?: number;
}): Promise<number> => {
  const spoolPath = getSpoolPath({ paths });
  const raw = await readFile(spoolPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return 0;
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const remaining: string[] = [];
  let processed = 0;
  for (const line of lines) {
    if (processed >= maxEntries) {
      remaining.push(line);
      continue;
    }
    let entry: IpcSpoolEntry | null = null;
    try {
      entry = JSON.parse(line) as IpcSpoolEntry;
    } catch {
      continue;
    }
    if (!entry?.type) {
      continue;
    }
    const handler = handlers[entry.type];
    if (!handler) {
      continue;
    }
    try {
      await handler({ payload: entry.payload, context: {} });
      processed += 1;
    } catch {
      remaining.push(line);
    }
  }
  if (remaining.length === 0) {
    await rm(spoolPath, { force: true });
  } else {
    await writeFile(spoolPath, `${remaining.join("\n")}\n`, "utf-8");
  }
  return processed;
};
