import type { Heartbeat } from "../state/heartbeat.js";
import { normalizeRelaunchTarget, parseRelaunchArgs } from "../commands/relaunch.js";
import { buildRelaunchEvent, selectRelaunchTargets } from "../relaunch/core.js";

describe("normalizeRelaunchTarget", () => {
  test("accepts canonical cN ids", () => {
    expect(normalizeRelaunchTarget({ target: "c3" })).toBe("c3");
  });

  test("prefixes numeric ids", () => {
    expect(normalizeRelaunchTarget({ target: "7" })).toBe("c7");
  });

  test("passes through planner or judge ids", () => {
    expect(normalizeRelaunchTarget({ target: "planner" })).toBe("planner");
    expect(normalizeRelaunchTarget({ target: "judge-2" })).toBe("judge-2");
  });
});

describe("parseRelaunchArgs", () => {
  test("defaults to resume mode", () => {
    expect(parseRelaunchArgs({ args: ["2"] })).toEqual({ mode: "resume", target: "c2" });
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
    expect(() => parseRelaunchArgs({ args: ["--nope", "c1"] })).toThrow("Unknown option");
  });

  test("errors when multiple targets provided", () => {
    expect(() => parseRelaunchArgs({ args: ["c1", "c2"] })).toThrow("Multiple targets");
  });
});

describe("selectRelaunchTargets", () => {
  const nowMs = new Date("2026-01-24T00:00:00.000Z").getTime();
  const makeHeartbeat = (overrides: Partial<Heartbeat>): Heartbeat => {
    return {
      slaveId: overrides.slaveId ?? "c1",
      ts: overrides.ts ?? new Date(nowMs).toISOString(),
      pid: overrides.pid,
      role: overrides.role,
    };
  };

  test("marks unknown target", () => {
    const result = selectRelaunchTargets({
      heartbeats: [makeHeartbeat({ slaveId: "c1", pid: 123 })],
      target: "c2",
      nowMs,
      staleMs: 30_000,
    });
    expect(result.unknownTarget).toBe(true);
    expect(result.eligible).toEqual([]);
  });

  test("filters stale and missing pid", () => {
    const result = selectRelaunchTargets({
      heartbeats: [
        makeHeartbeat({ slaveId: "c1", pid: 11 }),
        makeHeartbeat({ slaveId: "c2" }),
        makeHeartbeat({ slaveId: "c3", pid: 22, ts: new Date(nowMs - 60_000).toISOString() }),
      ],
      target: null,
      nowMs,
      staleMs: 30_000,
    });
    expect(result.eligible.map((hb) => hb.slaveId)).toEqual(["c1"]);
    expect(result.skipped.map((entry) => entry.slaveId).sort()).toEqual(["c2", "c3"]);
  });
});

describe("buildRelaunchEvent", () => {
  test("builds relaunch event payload", () => {
    const event = buildRelaunchEvent({
      mode: "resume",
      heartbeat: {
        slaveId: "c1",
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        pid: 123,
      },
    });
    expect(event.type).toBe("CODEX_RELAUNCH_REQUEST");
    expect(event.slaveId).toBe("c1");
    expect(event.data?.pid).toBe(123);
  });
});
