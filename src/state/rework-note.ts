import type { TaskRecord } from "./tasks.js";
import { readHistory } from "./history.js";

const formatJudgeHandoff = ({ handoff }: { handoff: string }): string => {
  const trimmed = handoff.trim();
  if (!trimmed) {
    return "";
  }
  return [`Judge handoff (rework guidance):`, trimmed].join("\n");
};

export const loadJudgeReworkNote = async ({
  historyDir,
  task,
}: {
  historyDir: string;
  task: TaskRecord;
}): Promise<string | undefined> => {
  if (task.status !== "rework") {
    return undefined;
  }
  const handoff = await readHistory({ historyDir, taskId: task.id, role: "judge" });
  if (!handoff) {
    return undefined;
  }
  const note = formatJudgeHandoff({ handoff });
  return note.length > 0 ? note : undefined;
};
