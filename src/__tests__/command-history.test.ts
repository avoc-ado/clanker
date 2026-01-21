import { appendHistoryEntry, normalizeHistoryEntries } from "../state/command-history.js";

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
});
