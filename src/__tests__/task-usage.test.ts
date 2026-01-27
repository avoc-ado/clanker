import { applyTaskUsage, mergeTaskUsage } from "../state/task-usage.js";
import type { TaskRecord } from "../state/tasks.js";

describe("task usage", () => {
  test("mergeTaskUsage overlays provided fields", () => {
    const task: TaskRecord = { id: "t1", status: "queued", prompt: "do" };
    const usage = mergeTaskUsage({ task, usage: { tokens: 10, cost: 2 } });
    expect(usage.tokens).toBe(10);
    expect(usage.cost).toBe(2);
  });

  test("applyTaskUsage returns null when empty", () => {
    const task: TaskRecord = { id: "t1", status: "queued", prompt: "do" };
    const result = applyTaskUsage({ task, usage: {} });
    expect(result).toBeNull();
  });

  test("applyTaskUsage accepts judge usage", () => {
    const task: TaskRecord = { id: "t1", status: "queued", prompt: "do" };
    const result = applyTaskUsage({ task, usage: { judgeTokens: 5, judgeCost: 1 } });
    expect(result?.judgeTokens).toBe(5);
  });

  test("applyTaskUsage accepts cost-only usage", () => {
    const task: TaskRecord = { id: "t1", status: "queued", prompt: "do" };
    const result = applyTaskUsage({ task, usage: { cost: 2 } });
    expect(result?.cost).toBe(2);
  });
});
