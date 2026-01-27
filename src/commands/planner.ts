import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";
import { loadConfig } from "../config.js";
import { formatPlannerId } from "../agent-ids.js";
import { getRepoRoot } from "../repo-root.js";
import { ensureRoleWorktrees, getWorktreePath, syncWorktreeToOriginMain } from "../worktrees.js";
import { appendEvent } from "../state/events.js";

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
  const syncResult = await syncWorktreeToOriginMain({ repoRoot, worktreePath });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "PLANNER_SYNC",
      msg:
        syncResult.status === "synced"
          ? "planner synced to origin/main"
          : syncResult.status === "dirty"
            ? "planner sync skipped; worktree dirty"
            : syncResult.status === "missing_worktree"
              ? "planner sync skipped; worktree missing"
              : (syncResult.message ?? "planner sync failed"),
      slaveId: plannerId,
      data: {
        status: syncResult.status,
        headSha: syncResult.headSha,
        worktreePath,
      },
    },
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
