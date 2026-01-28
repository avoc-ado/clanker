import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../state/state.js";

describe("state", () => {
  test("load default and save", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-state-"));
    const path = join(root, "state.json");

    const initial = await loadState({ statePath: path });
    expect(initial.paused).toBe(true);
    expect(initial.pausedRoles).toEqual({ planner: false, judge: false, slave: false });
    expect(initial.lockConflicts).toEqual({});
    expect(initial.promptApprovals.autoApprove).toEqual({
      planner: false,
      judge: false,
      slave: false,
    });
    expect(initial.promptApprovals.queue).toEqual([]);
    expect(initial.usageLimit).toEqual({ active: false });

    const updated = { ...initial, paused: false };
    await saveState({ statePath: path, state: updated });

    const raw = JSON.parse(await readFile(path, "utf-8")) as { paused: boolean };
    expect(raw.paused).toBe(false);
  });

  test("handles invalid json", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-state-bad-"));
    const path = join(root, "state.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, "{bad}", "utf-8"));

    const state = await loadState({ statePath: path });
    expect(state.paused).toBe(true);
    expect(state.pausedRoles).toEqual({ planner: false, judge: false, slave: false });
    expect(state.lockConflicts).toEqual({});
    expect(state.promptApprovals.autoApprove).toEqual({
      planner: false,
      judge: false,
      slave: false,
    });
    expect(state.usageLimit).toEqual({ active: false });
  });

  test("loads tasks from state", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-state-tasks-"));
    const path = join(root, "state.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        path,
        JSON.stringify({ paused: false, tasks: [{ id: "t1", status: "queued" }] }),
        "utf-8",
      ),
    );

    const state = await loadState({ statePath: path });
    expect(state.tasks.length).toBe(1);
    expect(state.paused).toBe(false);
    expect(state.pausedRoles).toEqual({ planner: false, judge: false, slave: false });
    expect(state.lockConflicts).toEqual({});
    expect(state.promptApprovals.queue).toEqual([]);
    expect(state.usageLimit).toEqual({ active: false });
  });

  test("defaults tasks when missing in state file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-state-missing-tasks-"));
    const path = join(root, "state.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(path, JSON.stringify({ paused: false }), "utf-8"),
    );

    const state = await loadState({ statePath: path });
    expect(state.tasks.length).toBe(0);
    expect(state.paused).toBe(false);
    expect(state.pausedRoles).toEqual({ planner: false, judge: false, slave: false });
    expect(state.lockConflicts).toEqual({});
    expect(state.promptApprovals.queue).toEqual([]);
    expect(state.usageLimit).toEqual({ active: false });
  });
});
