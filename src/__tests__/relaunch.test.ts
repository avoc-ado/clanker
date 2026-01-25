import type { Heartbeat } from "../state/heartbeat.js";
import { normalizeRelaunchTarget, parseRelaunchArgs } from "../commands/relaunch.js";
import { buildRelaunchEvent, selectRelaunchTargets } from "../relaunch/core.js";

describe("normalizeRelaunchTarget", () => {
  test("accepts canonical slave ids", () => {
    expect(normalizeRelaunchTarget({ target: "slave-3" })).toBe("slave-3");
  });

  test("prefixes numeric ids", () => {
    expect(normalizeRelaunchTarget({ target: "7" })).toBe("slave-7");
  });

  test("normalizes planner and judge ids", () => {
    expect(normalizeRelaunchTarget({ target: "planner" })).toBe("planner-1");
    expect(normalizeRelaunchTarget({ target: "judge" })).toBe("judge-1");
    expect(normalizeRelaunchTarget({ target: "judge-2" })).toBe("judge-2");
  });
});

describe("parseRelaunchArgs", () => {
  test("defaults to resume mode", () => {
    expect(parseRelaunchArgs({ args: ["2"] })).toEqual({ mode: "resume", target: "slave-2" });
  });

  test("allows relaunch all without target", () => {
    expect(parseRelaunchArgs({ args: [] })).toEqual({ mode: "resume", target: null });
  });

  test("parses fresh mode", () => {
    expect(parseRelaunchArgs({ args: ["--fresh", "planner-2"] })).toEqual({
      mode: "fresh",
      target: "planner-2",
    });
  });

  test("errors on unknown options", () => {
    expect(() => parseRelaunchArgs({ args: ["--nope", "slave-1"] })).toThrow("Unknown option");
  });

  test("errors when multiple targets provided", () => {
    expect(() => parseRelaunchArgs({ args: ["slave-1", "slave-2"] })).toThrow("Multiple targets");
  });
});

describe("selectRelaunchTargets", () => {
  const nowMs = new Date("2026-01-24T00:00:00.000Z").getTime();
  const makeHeartbeat = (overrides: Partial<Heartbeat>): Heartbeat => {
    return {
      slaveId: overrides.slaveId ?? "slave-1",
      ts: overrides.ts ?? new Date(nowMs).toISOString(),
      pid: overrides.pid,
      role: overrides.role,
    };
  };

  test("marks unknown target", () => {
    const result = selectRelaunchTargets({
      heartbeats: [makeHeartbeat({ slaveId: "slave-1", pid: 123 })],
      target: "slave-2",
      nowMs,
      staleMs: 30_000,
    });
    expect(result.unknownTarget).toBe(true);
    expect(result.eligible).toEqual([]);
  });

  test("filters stale and missing pid", () => {
    const result = selectRelaunchTargets({
      heartbeats: [
        makeHeartbeat({ slaveId: "slave-1", pid: 11 }),
        makeHeartbeat({ slaveId: "slave-2" }),
        makeHeartbeat({ slaveId: "slave-3", pid: 22, ts: new Date(nowMs - 60_000).toISOString() }),
      ],
      target: null,
      nowMs,
      staleMs: 30_000,
    });
    expect(result.eligible.map((hb) => hb.slaveId)).toEqual(["slave-1"]);
    expect(result.skipped.map((entry) => entry.slaveId).sort()).toEqual(["slave-2", "slave-3"]);
  });
});

describe("buildRelaunchEvent", () => {
  test("builds relaunch event payload", () => {
    const event = buildRelaunchEvent({
      mode: "resume",
      heartbeat: {
        slaveId: "slave-1",
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        pid: 123,
      },
    });
    expect(event.type).toBe("CODEX_RELAUNCH_REQUEST");
    expect(event.slaveId).toBe("slave-1");
    expect(event.data?.pid).toBe(123);
  });
});
