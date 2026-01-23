import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStateDirs } from "../state/ensure-state.js";
import type { ClankerPaths } from "../paths.js";

describe("ensureStateDirs", () => {
  test("creates state directories and state.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-state-"));
    const paths: ClankerPaths = {
      repoRoot: root,
      stateDir: join(root, ".clanker"),
      eventsLog: join(root, ".clanker", "events.log"),
      statePath: join(root, ".clanker", "state.json"),
      tasksDir: join(root, ".clanker", "tasks"),
      historyDir: join(root, ".clanker", "history"),
      heartbeatDir: join(root, ".clanker", "heartbeat"),
      metricsPath: join(root, ".clanker", "metrics.json"),
      logsDir: join(root, ".clanker", "logs"),
      locksDir: join(root, ".clanker", "locks"),
      archiveDir: join(root, ".clanker", "archive"),
      archiveTasksDir: join(root, ".clanker", "archive", "tasks"),
      commandHistoryPath: join(root, ".clanker", "command-history.json"),
    };

    await ensureStateDirs({ paths });
    const raw = await readFile(paths.statePath, "utf-8");
    const parsed = JSON.parse(raw) as { paused: boolean };
    expect(parsed.paused).toBe(true);
  });
});
