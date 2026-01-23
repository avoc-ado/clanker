import { readFile } from "node:fs/promises";

export const findResumeCommand = ({ text }: { text: string }): string | null => {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const match = /(codex\s+resume\s+\S.*)/.exec(line);
    if (match) {
      return match[1]?.trim() ?? null;
    }
  }
  return null;
};

export const extractResumeCommand = async ({
  logPath,
}: {
  logPath: string;
}): Promise<string | null> => {
  try {
    const raw = await readFile(logPath, "utf-8");
    return findResumeCommand({ text: raw });
  } catch {
    return null;
  }
};
