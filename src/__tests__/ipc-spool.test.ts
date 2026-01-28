import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendIpcSpoolEntry, drainIpcSpool } from "../ipc/spool.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { IPC_SPOOL_MAX_BYTES } from "../constants.js";

describe("ipc spool", () => {
  test("drains spool entries and clears file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-spool-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await appendIpcSpoolEntry({
      paths,
      entry: {
        ts: new Date().toISOString(),
        type: "task_create",
        payload: { task: { id: "t1", status: "queued", prompt: "do" } },
      },
    });
    const spoolPath = join(paths.stateDir, "ipc-spool.ndjson");
    const raw = await readFile(spoolPath, "utf-8");
    expect(raw).toContain("task_create");

    let handled = 0;
    const processed = await drainIpcSpool({
      paths,
      handlers: {
        task_create: async () => {
          handled += 1;
          return { ok: true };
        },
      },
    });
    expect(processed).toBe(1);
    expect(handled).toBe(1);
    await expect(readFile(spoolPath, "utf-8")).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  test("drain returns 0 when spool file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-spool-"));
    const paths = getClankerPaths({ repoRoot: root });
    const processed = await drainIpcSpool({
      paths,
      handlers: {},
    });
    expect(processed).toBe(0);
    await rm(root, { recursive: true, force: true });
  });

  test("drain skips invalid entries and preserves failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-spool-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const spoolPath = join(paths.stateDir, "ipc-spool.ndjson");
    const lines = [
      "not-json",
      JSON.stringify({ ts: new Date().toISOString(), payload: { ok: true } }),
      JSON.stringify({ ts: new Date().toISOString(), type: "unknown", payload: { ok: true } }),
      JSON.stringify({ ts: new Date().toISOString(), type: "task_note", payload: { ok: true } }),
      JSON.stringify({ ts: new Date().toISOString(), type: "task_create", payload: { ok: true } }),
    ];
    await writeFile(spoolPath, `${lines.join("\n")}\n`, "utf-8");
    const processed = await drainIpcSpool({
      paths,
      handlers: {
        task_note: async () => ({ ok: true }),
        task_create: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(processed).toBe(1);
    const remaining = await readFile(spoolPath, "utf-8");
    expect(remaining).toContain("task_create");
    expect(remaining).not.toContain("unknown");
    await rm(root, { recursive: true, force: true });
  });

  test("drain respects maxEntries and keeps remaining lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-spool-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const spoolPath = join(paths.stateDir, "ipc-spool.ndjson");
    const lines = [
      JSON.stringify({ ts: new Date().toISOString(), type: "task_note", payload: { id: 1 } }),
      JSON.stringify({ ts: new Date().toISOString(), type: "task_note", payload: { id: 2 } }),
    ];
    await writeFile(spoolPath, `${lines.join("\n")}\n`, "utf-8");
    const processed = await drainIpcSpool({
      paths,
      handlers: {
        task_note: async () => ({ ok: true }),
      },
      maxEntries: 1,
    });
    expect(processed).toBe(1);
    const remaining = await readFile(spoolPath, "utf-8");
    const remainingLines = remaining.trim().split("\n");
    expect(remainingLines).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  test("append trims spool size to max bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-spool-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const spoolPath = join(paths.stateDir, "ipc-spool.ndjson");
    const payloadLine = "x".repeat(2000);
    const lineCount = Math.ceil(
      (IPC_SPOOL_MAX_BYTES + payloadLine.length) / (payloadLine.length + 1),
    );
    const lines = Array.from({ length: lineCount }, () => payloadLine).join("\n");
    await writeFile(spoolPath, `${lines}\n`, "utf-8");
    await appendIpcSpoolEntry({
      paths,
      entry: {
        ts: new Date().toISOString(),
        type: "task_status",
        payload: { ok: true },
      },
    });
    const trimmed = await readFile(spoolPath, "utf-8");
    expect(Buffer.byteLength(trimmed)).toBeLessThanOrEqual(IPC_SPOOL_MAX_BYTES);
    expect(trimmed.trim().split("\n").pop()).toContain("task_status");
    await rm(root, { recursive: true, force: true });
  });
});
