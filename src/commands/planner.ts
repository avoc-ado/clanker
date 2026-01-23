import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";
import { loadConfig } from "../config.js";
import { formatPlannerId } from "../agent-ids.js";

export const runPlanner = async ({ idRaw }: { idRaw?: string } = {}): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  const plannerId = formatPlannerId({ idRaw });
  await runCodexSupervisor({
    paths,
    role: "planner",
    id: plannerId,
    command: config.codexCommand,
    readyEvent: { type: "PLANNER_READY", msg: "planner ready" },
  });
};
