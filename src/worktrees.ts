import { dirname, join } from "node:path";
import { runGit } from "./git.js";

export interface WorktreeNames {
  planner: string;
  judge: string;
  slave: string;
}

export const getWorktreeNames = ({
  profileNum,
  desk,
}: {
  profileNum: number;
  desk: string;
}): WorktreeNames => {
  return {
    planner: "c-planner",
    judge: "c-judge",
    slave: `c${profileNum}-${desk}`,
  };
};

const getWorktreeRoot = ({ repoRoot }: { repoRoot: string }): string => dirname(repoRoot);

export const getWorktreePath = ({ repoRoot, name }: { repoRoot: string; name: string }): string =>
  join(getWorktreeRoot({ repoRoot }), name);

export const addWorktree = async ({
  repoRoot,
  name,
  ref,
}: {
  repoRoot: string;
  name: string;
  ref: string;
}): Promise<void> => {
  const path = getWorktreePath({ repoRoot, name });
  await runGit({ args: ["worktree", "add", path, ref], cwd: repoRoot });
};

export const removeWorktree = async ({
  repoRoot,
  name,
}: {
  repoRoot: string;
  name: string;
}): Promise<void> => {
  const path = getWorktreePath({ repoRoot, name });
  await runGit({ args: ["worktree", "remove", path], cwd: repoRoot });
};
