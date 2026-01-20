import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { listTasks } from "../state/tasks.js";
import { validateTaskRecord } from "../state/task-validate.js";
import { runGit } from "../git.js";
import { getWorktreePath } from "../worktrees.js";
import { access } from "node:fs/promises";

export const runHealth = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });

  const tasks = await listTasks({ tasksDir: paths.tasksDir });
  const healthWarnings: string[] = [];

  const invalid = tasks.filter((task) => !validateTaskRecord({ task }).isValid);
  const warnings = tasks
    .map((task) => ({ task, warnings: validateTaskRecord({ task }).warnings }))
    .filter((entry) => entry.warnings.length > 0);
  try {
    const head = await runGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
    const drifted = tasks.filter((task) => task.baseMainSha && task.baseMainSha !== head);
    if (drifted.length > 0) {
      healthWarnings.push(`baseMainSha drift for ${drifted.length} task(s)`);
    }
  } catch {
    healthWarnings.push("git rev-parse failed");
  }

  const plannerPath = getWorktreePath({ repoRoot, name: "c-planner" });
  const judgePath = getWorktreePath({ repoRoot, name: "c-judge" });
  const worktreeChecks = await Promise.all([
    access(plannerPath).then(
      () => null,
      () => "missing worktree c-planner",
    ),
    access(judgePath).then(
      () => null,
      () => "missing worktree c-judge",
    ),
  ]);
  for (const warning of worktreeChecks.filter(Boolean)) {
    if (warning) {
      healthWarnings.push(warning);
    }
  }

  if (tasks.length === 0 && healthWarnings.length === 0) {
    console.log("health: no tasks");
    return;
  }
  if (invalid.length === 0 && warnings.length === 0 && healthWarnings.length === 0) {
    console.log("health: ok");
    return;
  }

  console.log(`health: ${invalid.length} invalid task(s)`);
  for (const task of invalid) {
    const errors = validateTaskRecord({ task }).errors.join(", ");
    console.log(`- ${task.id}: ${errors}`);
  }

  if (warnings.length > 0) {
    console.log(`health: ${warnings.length} warning task(s)`);
    for (const entry of warnings) {
      console.log(`- ${entry.task.id}: ${entry.warnings.join(", ")}`);
    }
  }

  if (healthWarnings.length > 0) {
    console.log(`health: ${healthWarnings.length} repo warning(s)`);
    for (const warning of healthWarnings) {
      console.log(`- ${warning}`);
    }
  }
};
