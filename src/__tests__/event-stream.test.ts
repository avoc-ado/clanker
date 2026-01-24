import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillTaskPackets,
  ensureEventsLog,
  renderEventLine,
  startEventStream,
} from "../dashboard/event-stream.js";
import { saveTask } from "../state/tasks.js";
import type { ClankerEvent } from "../state/events.js";

describe("event stream helpers", () => {
  test("renderEventLine records tasks and writes output", () => {
    const knownTaskIds = new Set<string>();
    const lines: string[] = [];
    const formatStreamLine = ({ event }: { event: ClankerEvent }) => ({
      line: `${event.type}:${event.msg}`,
      date: new Date(event.ts),
    });
    const raw = JSON.stringify({
      ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
      type: "TASK_PACKET",
      msg: "packet issued",
      taskId: "t1",
    });
    renderEventLine({
      raw,
      knownTaskIds,
      writeDividerIfNeeded: () => undefined,
      writeLine: (line) => lines.push(line),
      formatStreamLine,
    });
    expect(lines).toEqual(["TASK_PACKET:packet issued"]);
    expect(knownTaskIds.has("t1")).toBe(true);
  });

  test("renderEventLine skips empty and unformatted lines", () => {
    const knownTaskIds = new Set<string>();
    const lines: string[] = [];
    renderEventLine({
      raw: "   ",
      knownTaskIds,
      writeDividerIfNeeded: () => undefined,
      writeLine: (line) => lines.push(line),
      formatStreamLine: () => ({ line: "ignored", date: new Date() }),
    });
    renderEventLine({
      raw: JSON.stringify({
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        type: "TASK_PACKET",
        msg: "packet issued",
      }),
      knownTaskIds,
      writeDividerIfNeeded: () => undefined,
      writeLine: (line) => lines.push(line),
      formatStreamLine: () => null,
    });
    expect(lines).toEqual([]);
  });

  test("renderEventLine ignores invalid json", () => {
    const knownTaskIds = new Set<string>();
    const lines: string[] = [];
    renderEventLine({
      raw: "not-json",
      knownTaskIds,
      writeDividerIfNeeded: () => undefined,
      writeLine: (line) => lines.push(line),
      formatStreamLine: () => ({ line: "ignored", date: new Date() }),
    });
    expect(lines).toEqual([]);
    expect(knownTaskIds.size).toBe(0);
  });

  test("ensureEventsLog creates file and backfillTaskPackets writes events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-events-"));
    const eventsLog = join(dir, "events.log");
    const tasksDir = join(dir, "tasks");
    await ensureEventsLog({ eventsLog });
    await mkdir(tasksDir, { recursive: true });
    await saveTask({
      tasksDir,
      task: {
        id: "t1",
        status: "queued",
        prompt: "do work",
      },
    });
    const knownTaskIds = new Set<string>();
    await backfillTaskPackets({ tasksDir, knownTaskIds, eventsLog });
    const raw = await readFile(eventsLog, "utf-8");
    expect(raw).toContain("TASK_PACKET");
    await rm(dir, { recursive: true, force: true });
  });

  test("backfillTaskPackets skips known tasks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-events-known-"));
    const eventsLog = join(dir, "events.log");
    const tasksDir = join(dir, "tasks");
    await ensureEventsLog({ eventsLog });
    await mkdir(tasksDir, { recursive: true });
    await saveTask({
      tasksDir,
      task: {
        id: "t1",
        status: "queued",
        prompt: "do work",
      },
    });
    await saveTask({
      tasksDir,
      task: {
        id: "t2",
        status: "queued",
        prompt: "do work",
      },
    });
    const knownTaskIds = new Set<string>(["t1"]);
    await backfillTaskPackets({ tasksDir, knownTaskIds, eventsLog });
    const raw = await readFile(eventsLog, "utf-8");
    expect(raw).toContain('"t2"');
    expect(raw).not.toContain('"t1"');
    await rm(dir, { recursive: true, force: true });
  });

  test("startEventStream replays existing events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-stream-"));
    const eventsLog = join(dir, "events.log");
    const lines: string[] = [];
    const event = {
      ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
      type: "TASK_PACKET",
      msg: "packet issued",
      taskId: "t2",
    };
    await writeFile(eventsLog, `${JSON.stringify(event)}\n`, "utf-8");
    const stop = await startEventStream({
      eventsLog,
      streamLimit: 10,
      knownTaskIds: new Set<string>(),
      writeDividerIfNeeded: () => undefined,
      writeLine: (line) => lines.push(line),
      formatStreamLine: ({ event: ev }) => ({ line: ev.msg ?? "", date: new Date(ev.ts) }),
    });
    stop?.();
    expect(lines).toEqual(["packet issued"]);
    await rm(dir, { recursive: true, force: true });
  });

  test("startEventStream returns null for directory path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-stream-dir-"));
    const eventsLog = join(dir, "events-dir");
    await mkdir(eventsLog, { recursive: true });
    const stop = await startEventStream({
      eventsLog,
      streamLimit: 10,
      knownTaskIds: new Set<string>(),
      writeDividerIfNeeded: () => undefined,
      writeLine: () => undefined,
      formatStreamLine: () => ({ line: "x", date: new Date() }),
    });
    expect(stop).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("startEventStream reacts to watch events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-stream-watch-"));
    const eventsLog = join(dir, "events.log");
    const lines: string[] = [];
    const event = {
      ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
      type: "TASK_PACKET",
      msg: "packet issued",
      taskId: "t3",
    };
    await writeFile(eventsLog, `${JSON.stringify(event)}\n`, "utf-8");

    let listener: ((eventType: string) => void) | null = null;
    const watchFile = (_path: string, callback: (eventType: string) => void) => {
      listener = callback;
      return { close: () => undefined };
    };

    const stop = await startEventStream({
      eventsLog,
      streamLimit: 10,
      knownTaskIds: new Set<string>(),
      writeDividerIfNeeded: () => undefined,
      writeLine: (line) => lines.push(line),
      formatStreamLine: ({ event: ev }) => ({ line: ev.msg ?? "", date: new Date(ev.ts) }),
      watchFile,
    });

    const runListener = listener as ((eventType: string) => void) | null;
    if (runListener) {
      runListener("rename");
      runListener("change");
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(
        eventsLog,
        `${JSON.stringify(event)}\n${JSON.stringify({
          ...event,
          msg: "another",
          taskId: "t4",
        })}\n`,
        "utf-8",
      );
      runListener("change");
      await new Promise((resolve) => setTimeout(resolve, 10));
      await rm(eventsLog, { force: true });
      runListener("change");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    stop?.();
    expect(lines.some((line) => line.includes("packet issued"))).toBe(true);
    expect(lines.some((line) => line.includes("another"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
