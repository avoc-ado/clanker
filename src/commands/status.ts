import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { loadState } from "../state/state.js";
import { loadMetrics } from "../state/metrics.js";
import { sparkline } from "../format/sparkline.js";

export const runStatus = async ({}: {}): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  const config = await loadConfig({ repoRoot });
  const state = await loadState({ statePath: paths.statePath });
  const metrics = await loadMetrics({ metricsPath: paths.metricsPath });

  const taskCount = state.tasks.length;
  const pausedLabel = state.paused ? "paused" : "running";

  console.log(`planners=${config.planners}`);
  console.log(`judges=${config.judges}`);
  console.log(`slaves=${config.slaves}`);
  console.log(`tmuxSession=${config.tmuxSession ?? "-"}`);
  console.log(`codexCommand=${config.codexCommand ?? "-"}`);
  console.log(`state=${pausedLabel}`);
  console.log(`tasks=${taskCount}`);
  if (metrics.burnHistory.length > 0) {
    console.log(`burn=${sparkline({ values: metrics.burnHistory })}`);
  }
  if (metrics.backlogHistory.length > 0) {
    console.log(`backlog=${sparkline({ values: metrics.backlogHistory })}`);
  }
};
