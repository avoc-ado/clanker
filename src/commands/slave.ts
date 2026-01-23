import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { runCodexSupervisor } from "./codex-supervisor.js";

const parseSlaveId = ({ idRaw }: { idRaw: string | undefined }): string => {
  if (!idRaw) {
    throw new Error("Missing slave id (expected: clanker slave <n>)");
  }
  return `c${idRaw}`;
};

export const runSlave = async ({ idRaw }: { idRaw: string | undefined }): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  const slaveId = parseSlaveId({ idRaw });
  await runCodexSupervisor({
    paths,
    role: "slave",
    id: slaveId,
    command: config.codexCommand,
    statusLine: `clanker slave ${slaveId} (slaves=${config.slaves})`,
    readyEvent: { type: "SLAVE_READY", msg: "waiting for assignments" },
  });
};
