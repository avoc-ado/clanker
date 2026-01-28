import { jest } from "@jest/globals";
import type { TaskRecord } from "../state/tasks.js";

const readHistoryMock = jest.fn<
  Promise<string | null>,
  [
    {
      historyDir: string;
      taskId: string;
      role: "judge" | "slave";
    },
  ]
>();

jest.unstable_mockModule("../state/history.js", () => ({
  readHistory: readHistoryMock,
}));

const { loadJudgeReworkNote } = await import("../state/rework-note.js");

describe("loadJudgeReworkNote", () => {
  beforeEach(() => {
    readHistoryMock.mockReset();
  });

  test("skips when task is not rework", async () => {
    const task = { id: "t1", status: "running" } satisfies TaskRecord;
    const note = await loadJudgeReworkNote({ historyDir: "/tmp/history", task });
    expect(note).toBeUndefined();
    expect(readHistoryMock).not.toHaveBeenCalled();
  });

  test("returns undefined when no judge handoff exists", async () => {
    readHistoryMock.mockResolvedValue(null);
    const task = { id: "t2", status: "rework" } satisfies TaskRecord;
    const note = await loadJudgeReworkNote({ historyDir: "/tmp/history", task });
    expect(note).toBeUndefined();
    expect(readHistoryMock).toHaveBeenCalledWith({
      historyDir: "/tmp/history",
      taskId: "t2",
      role: "judge",
    });
  });

  test("returns formatted note when judge handoff exists", async () => {
    readHistoryMock.mockResolvedValue("Judge says fix tests\nMore details");
    const task = { id: "t3", status: "rework" } satisfies TaskRecord;
    const note = await loadJudgeReworkNote({ historyDir: "/tmp/history", task });
    expect(note).toContain("Judge handoff (rework guidance):");
    expect(note).toContain("Judge says fix tests");
  });

  test("skips when judge handoff is whitespace", async () => {
    readHistoryMock.mockResolvedValue(" \n\n ");
    const task = { id: "t4", status: "rework" } satisfies TaskRecord;
    const note = await loadJudgeReworkNote({ historyDir: "/tmp/history", task });
    expect(note).toBeUndefined();
  });
});
