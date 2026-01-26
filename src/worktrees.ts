import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runGit } from "./git.js";

export type WorktreeRole = "planner" | "judge" | "slave";

export interface WorktreeSpec {
  role: WorktreeRole;
  index: number;
  name: string;
  path: string;
}

export const getWorktreeRoot = ({ repoRoot }: { repoRoot: string }): string =>
  join(repoRoot, ".clanker", "worktree");

export const getWorktreeName = ({ role, index }: { role: WorktreeRole; index: number }): string =>
  `${role}-${index}`;

export const getWorktreePath = ({
  repoRoot,
  role,
  index,
}: {
  repoRoot: string;
  role: WorktreeRole;
  index: number;
}): string => join(getWorktreeRoot({ repoRoot }), getWorktreeName({ role, index }));

export const listWorktreeSpecs = ({
  repoRoot,
  planners,
  judges,
  slaves,
}: {
  repoRoot: string;
  planners: number;
  judges: number;
  slaves: number;
}): WorktreeSpec[] => {
  const specs: WorktreeSpec[] = [];
  for (let i = 1; i <= planners; i += 1) {
    specs.push({
      role: "planner",
      index: i,
      name: getWorktreeName({ role: "planner", index: i }),
      path: getWorktreePath({ repoRoot, role: "planner", index: i }),
    });
  }
  for (let i = 1; i <= judges; i += 1) {
    specs.push({
      role: "judge",
      index: i,
      name: getWorktreeName({ role: "judge", index: i }),
      path: getWorktreePath({ repoRoot, role: "judge", index: i }),
    });
  }
  for (let i = 1; i <= slaves; i += 1) {
    specs.push({
      role: "slave",
      index: i,
      name: getWorktreeName({ role: "slave", index: i }),
      path: getWorktreePath({ repoRoot, role: "slave", index: i }),
    });
  }
  return specs;
};

const ensureWorktreePath = async ({
  repoRoot,
  path,
  ref,
}: {
  repoRoot: string;
  path: string;
  ref: string;
}): Promise<void> => {
  try {
    await stat(path);
    try {
      await stat(join(path, ".git"));
      return;
    } catch {
      throw new Error(`worktree path exists but is not a git worktree: ${path}`);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code && err.code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await runGit({ args: ["worktree", "add", "--detach", path, ref], cwd: repoRoot });
};

export const ensureRoleWorktrees = async ({
  repoRoot,
  planners,
  judges,
  slaves,
  ref,
}: {
  repoRoot: string;
  planners: number;
  judges: number;
  slaves: number;
  ref: string;
}): Promise<WorktreeSpec[]> => {
  const specs = listWorktreeSpecs({ repoRoot, planners, judges, slaves });
  try {
    await runGit({ args: ["rev-parse", "--verify", ref], cwd: repoRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const helper = [
      `worktree ref ${ref} not found.`,
      `Git error: ${message}`,
      "Clanker needs a GitHub remote named origin with primary branch main.",
      "Fix:",
      "- Create a GitHub repo and set default branch to main.",
      "- git remote add origin <url>",
      "- git fetch origin",
      "- git push -u origin main",
    ].join("\n");
    throw new Error(helper);
  }
  await mkdir(getWorktreeRoot({ repoRoot }), { recursive: true });
  for (const spec of specs) {
    await ensureWorktreePath({ repoRoot, path: spec.path, ref });
  }
  return specs;
};
