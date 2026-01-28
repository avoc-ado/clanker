import { readFile, writeFile } from "node:fs/promises";
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

export const readHistory = async ({
  historyDir,
  taskId,
  role,
}: {
  historyDir: string;
  taskId: string;
  role: HistoryRole;
}): Promise<string | null> => {
  const path = join(historyDir, `task-${taskId}-${role}.md`);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
};
