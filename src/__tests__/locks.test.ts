import { buildLockState, countLockConflicts, hasLockConflict } from "../state/locks.js";
import type { TaskRecord } from "../state/tasks.js";

describe("locks", () => {
  test("dir lock conflicts with queued dir", () => {
    const busy: TaskRecord = { id: "t1", status: "running", prompt: "x", ownerDirs: ["src"] };
    const queued: TaskRecord = { id: "t2", status: "queued", prompt: "y", ownerDirs: ["src"] };
    const lockState = buildLockState({ tasks: [busy] });
    expect(hasLockConflict({ task: queued, lockState })).toBe(true);
  });

  test("file lock conflicts with dir lock", () => {
    const busy: TaskRecord = { id: "t1", status: "running", prompt: "x", ownerFiles: ["src/a.ts"] };
    const queued: TaskRecord = { id: "t2", status: "queued", prompt: "y", ownerDirs: ["src"] };
    const lockState = buildLockState({ tasks: [busy] });
    expect(hasLockConflict({ task: queued, lockState })).toBe(true);
  });

  test("file lock conflicts with same file", () => {
    const busy: TaskRecord = { id: "t1", status: "running", prompt: "x", ownerFiles: ["src/a.ts"] };
    const queued: TaskRecord = { id: "t2", status: "queued", prompt: "y", ownerFiles: ["src/a.ts"] };
    const lockState = buildLockState({ tasks: [busy] });
    expect(hasLockConflict({ task: queued, lockState })).toBe(true);
  });

  test("file lock does not conflict with different file", () => {
    const busy: TaskRecord = { id: "t1", status: "running", prompt: "x", ownerFiles: ["src/a.ts"] };
    const queued: TaskRecord = { id: "t2", status: "queued", prompt: "y", ownerFiles: ["src/b.ts"] };
    const lockState = buildLockState({ tasks: [busy] });
    expect(hasLockConflict({ task: queued, lockState })).toBe(false);
  });

  test("counts lock conflicts", () => {
    const tasks: TaskRecord[] = [
      { id: "t1", status: "running", prompt: "x", ownerDirs: ["src"] },
      { id: "t2", status: "running", prompt: "y", ownerDirs: ["src/components"] },
      { id: "t3", status: "running", prompt: "z", ownerFiles: ["scripts/build.ts"] },
    ];
    expect(countLockConflicts({ tasks })).toBe(1);
  });
});
