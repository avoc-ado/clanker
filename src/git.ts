import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runGit = async ({
  args,
  cwd,
}: {
  args: string[];
  cwd: string;
}): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
};

export const listDirtyFiles = async ({ cwd }: { cwd: string }): Promise<string[]> => {
  try {
    const output = await runGit({ args: ["status", "--porcelain"], cwd });
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const rawPath = line.slice(3).trim();
        if (rawPath.includes("->")) {
          const parts = rawPath.split("->").map((part) => part.trim());
          return parts[parts.length - 1] ?? rawPath;
        }
        return rawPath;
      });
  } catch {
    return [];
  }
};
