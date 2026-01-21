import { readFile, writeFile } from "node:fs/promises";

export interface CommandHistoryFile {
  entries: string[];
  updatedAt: string;
}

export const normalizeHistoryEntries = ({
  entries,
  maxEntries,
}: {
  entries: string[];
  maxEntries: number;
}): string[] => {
  const trimmed = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const deduped: string[] = [];
  for (const entry of trimmed) {
    if (deduped[deduped.length - 1] === entry) {
      continue;
    }
    deduped.push(entry);
  }
  if (deduped.length <= maxEntries) {
    return deduped;
  }
  return deduped.slice(deduped.length - maxEntries);
};

export const appendHistoryEntry = ({
  entries,
  entry,
  maxEntries,
}: {
  entries: string[];
  entry: string;
  maxEntries: number;
}): string[] => {
  return normalizeHistoryEntries({
    entries: [...entries, entry],
    maxEntries,
  });
};

export const loadCommandHistory = async ({
  path,
  maxEntries,
}: {
  path: string;
  maxEntries: number;
}): Promise<string[]> => {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as CommandHistoryFile;
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    return normalizeHistoryEntries({
      entries: parsed.entries,
      maxEntries,
    });
  } catch {
    return [];
  }
};

export const saveCommandHistory = async ({
  path,
  entries,
  maxEntries,
}: {
  path: string;
  entries: string[];
  maxEntries: number;
}): Promise<void> => {
  const payload: CommandHistoryFile = {
    entries: normalizeHistoryEntries({ entries, maxEntries }),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
};
