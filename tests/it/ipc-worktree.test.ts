import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildIpcHandlers } from "../../src/ipc/handlers.js";
import { startIpcServer } from "../../src/ipc/server.js";
import { getClankerPaths } from "../../src/paths.js";
import { ensureStateDirs } from "../../src/state/ensure-state.js";
import { ensureRoleWorktrees, getWorktreePath } from "../../src/worktrees.js";
import { ensureExists, makeTmpRepo, runCli } from "./utils.js";

describe("integration: ipc worktree", () => {
  test("worktree task add writes to root via ipc", async () => {
    const root = await makeTmpRepo({ planLines: ["Goal: IPC worktree add."] });
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const ipcSocket = join(root, ".clanker", "ipc.sock");
    const server = await startIpcServer({
      socketPath: ipcSocket,
      handlers: buildIpcHandlers({ paths }),
    });

    try {
      await ensureRoleWorktrees({
        repoRoot: root,
        planners: 0,
        judges: 0,
        slaves: 1,
        ref: "origin/main",
      });
      const worktreeRoot = getWorktreePath({ repoRoot: root, role: "slave", index: 1 });

      await runCli({
        cwd: worktreeRoot,
        args: ["task", "add", "ipc-1", "do it"],
        env: { CLANKER_IPC_SOCKET: ipcSocket },
      });

      const rootTaskPath = join(root, ".clanker", "tasks", "ipc-1.json");
      await ensureExists({ path: rootTaskPath, label: "root task packet" });
      const rootTaskRaw = await readFile(rootTaskPath, "utf-8");
      expect(rootTaskRaw).toContain('"id": "ipc-1"');

      const worktreeTaskPath = join(worktreeRoot, ".clanker", "tasks", "ipc-1.json");
      await expect(readFile(worktreeTaskPath, "utf-8")).rejects.toThrow();
    } finally {
      await server.close();
    }
  }, 20_000);
});
