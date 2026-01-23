import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";
import { loadConfig } from "../config.js";
import { formatJudgeId } from "../agent-ids.js";

export const runJudge = async ({ idRaw }: { idRaw?: string } = {}): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  const judgeId = formatJudgeId({ idRaw });
  await runCodexSupervisor({
    paths,
    role: "judge",
    id: judgeId,
    command: config.codexCommand,
    readyEvent: { type: "JUDGE_READY", msg: "judge ready" },
  });
};
