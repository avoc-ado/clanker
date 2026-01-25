import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";
import { loadConfig } from "../config.js";
import { formatPlannerId } from "../agent-ids.js";
import { getRepoRoot } from "../repo-root.js";
import { ensureRoleWorktrees, getWorktreePath } from "../worktrees.js";

export const runPlanner = async ({ idRaw }: { idRaw?: string } = {}): Promise<void> => {
  const repoRoot = getRepoRoot();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  await ensureRoleWorktrees({
    repoRoot,
    planners: config.planners,
    judges: config.judges,
    slaves: config.slaves,
    ref: "origin/main",
  });
  const plannerId = formatPlannerId({ idRaw });
  const indexRaw = idRaw?.trim();
  const index = indexRaw ? Number(indexRaw) : 1;
  const plannerIndex = Number.isFinite(index) && index > 0 ? index : 1;
  const worktreePath = getWorktreePath({
    repoRoot,
    role: "planner",
    index: plannerIndex,
  });
  if (!process.env.CLANKER_REPO_ROOT) {
    process.env.CLANKER_REPO_ROOT = repoRoot;
  }
  await runCodexSupervisor({
    paths,
    role: "planner",
    id: plannerId,
    command: config.codexCommand,
    cwd: worktreePath,
    readyEvent: { type: "PLANNER_READY", msg: "planner ready" },
  });
};
