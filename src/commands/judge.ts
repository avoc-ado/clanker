import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";
import { loadConfig } from "../config.js";
import { formatJudgeId } from "../agent-ids.js";
import { getRepoRoot } from "../repo-root.js";
import { ensureRoleWorktrees, getWorktreePath } from "../worktrees.js";

export const runJudge = async ({ idRaw }: { idRaw?: string } = {}): Promise<void> => {
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
  const judgeId = formatJudgeId({ idRaw });
  const indexRaw = idRaw?.trim();
  const index = indexRaw ? Number(indexRaw) : 1;
  const judgeIndex = Number.isFinite(index) && index > 0 ? index : 1;
  const worktreePath = getWorktreePath({
    repoRoot,
    role: "judge",
    index: judgeIndex,
  });
  if (!process.env.CLANKER_REPO_ROOT) {
    process.env.CLANKER_REPO_ROOT = repoRoot;
  }
  await runCodexSupervisor({
    paths,
    role: "judge",
    id: judgeId,
    command: config.codexCommand,
    cwd: worktreePath,
    readyEvent: { type: "JUDGE_READY", msg: "judge ready" },
  });
};
