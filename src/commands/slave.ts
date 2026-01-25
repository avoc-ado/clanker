import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";
import { getRepoRoot } from "../repo-root.js";
import { ensureRoleWorktrees, getWorktreePath } from "../worktrees.js";

const parseSlaveId = ({ idRaw }: { idRaw: string | undefined }): string => {
  if (!idRaw) {
    throw new Error("Missing slave id (expected: clanker slave <n>)");
  }
  return `c${idRaw}`;
};

export const runSlave = async ({ idRaw }: { idRaw: string | undefined }): Promise<void> => {
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
  const slaveId = parseSlaveId({ idRaw });
  const index = Number(idRaw);
  const slaveIndex = Number.isFinite(index) && index > 0 ? index : 1;
  const worktreePath = getWorktreePath({
    repoRoot,
    role: "slave",
    index: slaveIndex,
  });
  if (!process.env.CLANKER_REPO_ROOT) {
    process.env.CLANKER_REPO_ROOT = repoRoot;
  }
  await runCodexSupervisor({
    paths,
    role: "slave",
    id: slaveId,
    command: config.codexCommand,
    cwd: worktreePath,
    statusLine: `clanker slave ${slaveId} (slaves=${config.slaves})`,
    readyEvent: { type: "SLAVE_READY", msg: "waiting for assignments" },
  });
};
