import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistoryEntry,
  loadCommandHistory,
  normalizeHistoryEntries,
  saveCommandHistory,
} from "../state/command-history.js";

describe("command-history", () => {
  test("normalize trims, drops empties, and caps length", () => {
    const normalized = normalizeHistoryEntries({
      entries: ["", " /pause ", " ", "/resume", "/task 1 done"],
      maxEntries: 2,
    });
    expect(normalized).toEqual(["/resume", "/task 1 done"]);
  });

  test("normalize removes consecutive duplicates", () => {
    const normalized = normalizeHistoryEntries({
      entries: ["/pause", "/pause", "/resume"],
      maxEntries: 10,
    });
    expect(normalized).toEqual(["/pause", "/resume"]);
  });

  test("appendHistoryEntry appends and normalizes", () => {
    const appended = appendHistoryEntry({
      entries: ["/pause"],
      entry: " /pause ",
      maxEntries: 10,
    });
    expect(appended).toEqual(["/pause"]);
  });

  test("loadCommandHistory returns empty on invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-history-"));
    const path = join(root, "history.json");
    await writeFile(path, "{bad", "utf-8");
    await expect(loadCommandHistory({ path, maxEntries: 5 })).resolves.toEqual([]);
  });

  test("loadCommandHistory returns empty when entries missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-history-"));
    const path = join(root, "history.json");
    await writeFile(path, JSON.stringify({ entries: "bad" }), "utf-8");
    await expect(loadCommandHistory({ path, maxEntries: 5 })).resolves.toEqual([]);
  });

  test("saveCommandHistory writes normalized entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-history-"));
    const path = join(root, "history.json");
    await saveCommandHistory({
      path,
      entries: [" /pause ", "", "/pause", "/resume"],
      maxEntries: 2,
    });
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { entries: string[]; updatedAt: string };
    expect(parsed.entries).toEqual(["/pause", "/resume"]);
    expect(parsed.updatedAt.length).toBeGreaterThan(0);
  });
});
