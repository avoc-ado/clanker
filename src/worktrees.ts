import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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

const acquireWorktreeLock = async ({
  repoRoot,
}: {
  repoRoot: string;
}): Promise<() => Promise<void>> => {
  const lockPath = join(getWorktreeRoot({ repoRoot }), ".lock");
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${Date.now()}\n`, "utf-8");
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== "EEXIST") {
        throw error;
      }
    }
    try {
      const stats = await stat(lockPath);
      if (Date.now() - stats.mtimeMs > 60_000) {
        await rm(lockPath, { force: true });
        continue;
      }
    } catch {
      // ignore missing lock
    }
    if (Date.now() > deadline) {
      throw new Error(`worktree lock timeout: ${lockPath}`);
    }
    await delay(100);
  }
};

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
  const hasWorktree = async (): Promise<boolean> => {
    try {
      await stat(join(path, ".git"));
      return true;
    } catch {
      return false;
    }
  };
  try {
    await stat(path);
    if (await hasWorktree()) {
      return;
    }
    throw new Error(`worktree path exists but is not a git worktree: ${path}`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code && err.code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await runGit({ args: ["worktree", "add", "--detach", path, ref], cwd: repoRoot });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        if (await hasWorktree()) {
          return;
        }
      }
      const isLockError =
        message.includes("index.lock") ||
        message.includes("Another git process seems to be running") ||
        message.includes("Could not write new index file") ||
        message.includes("missing but already registered worktree");
      if (!isLockError) {
        throw error;
      }
      if (message.includes("missing but already registered worktree") && !(await hasWorktree())) {
        await runGit({ args: ["worktree", "prune"], cwd: repoRoot });
      }
      if (await hasWorktree()) {
        return;
      }
      await delay(150 * (attempt + 1));
    }
  }
  throw lastError;
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
  const releaseLock = await acquireWorktreeLock({ repoRoot });
  try {
    for (const spec of specs) {
      await ensureWorktreePath({ repoRoot, path: spec.path, ref });
    }
  } finally {
    await releaseLock();
  }
  return specs;
};
