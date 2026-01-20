import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type HistoryRole = "slave" | "judge";

export const writeHistory = async ({
  historyDir,
  taskId,
  role,
  content,
}: {
  historyDir: string;
  taskId: string;
  role: HistoryRole;
  content: string;
}): Promise<void> => {
  const path = join(historyDir, `task-${taskId}-${role}.md`);
  await writeFile(path, content, "utf-8");
};
