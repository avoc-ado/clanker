import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadState, saveState } from "../state/state.js";
import { appendEvent } from "../state/events.js";
import { runDashboard } from "./dashboard.js";
import { getRepoRoot } from "../repo-root.js";

export const runResume = async (): Promise<void> => {
  const repoRoot = getRepoRoot();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const state = await loadState({ statePath: paths.statePath });
  state.paused = false;
  state.pausedRoles = { planner: false, judge: false, slave: false };
  await saveState({ statePath: paths.statePath, state });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "RESUMED",
      msg: "resume via cli",
    },
  });
  await runDashboard({});
};
