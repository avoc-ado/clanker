import { validateTaskRecord } from "../state/task-validate.js";
import type { TaskRecord } from "../state/tasks.js";

describe("validateTaskRecord", () => {
  test("accepts valid task", () => {
    const task: TaskRecord = {
      id: "t1",
      status: "queued",
      prompt: "do the thing",
    };
    const result = validateTaskRecord({ task });
    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("rejects missing prompt", () => {
    const task = {
      id: "t2",
      status: "queued",
    } as TaskRecord;
    const result = validateTaskRecord({ task });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(", ")).toContain("missing prompt");
  });

  test("rejects invalid status", () => {
    const task = {
      id: "t3",
      status: "nope",
      prompt: "x",
    } as unknown as TaskRecord;
    const result = validateTaskRecord({ task });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(", ")).toContain("invalid status");
  });

  test("rejects invalid ownerDirs", () => {
    const task = {
      id: "t4",
      status: "queued",
      prompt: "x",
      ownerDirs: [""],
    } as TaskRecord;
    const result = validateTaskRecord({ task });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(", ")).toContain("invalid ownerDirs");
  });

  test("accepts ownerFiles without ownerDirs warning", () => {
    const task: TaskRecord = {
      id: "t5",
      status: "queued",
      prompt: "x",
      ownerFiles: ["src/a.ts"],
    };
    const result = validateTaskRecord({ task });
    expect(result.isValid).toBe(true);
    expect(result.warnings.join(", ")).not.toContain("missing ownerDirs");
  });

  test("rejects invalid ownerFiles", () => {
    const task = {
      id: "t6",
      status: "queued",
      prompt: "x",
      ownerFiles: [""],
    } as TaskRecord;
    const result = validateTaskRecord({ task });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(", ")).toContain("invalid ownerFiles");
  });
});
