import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import { listPanes, sendKeys } from "../tmux.js";
import { formatTaskSchema } from "../plan/schema.js";
import { buildContextPack } from "../context/context-pack.js";
import { loadConfig } from "../config.js";
import { buildPlanFileDispatch, getPromptSettings } from "../prompting.js";

const formatContextEntries = ({
  entries,
}: {
  entries: { title: string; content: string }[];
}): string => {
  if (entries.length === 0) {
    return "(none)";
  }
  return entries
    .map((entry) => {
      const clipped =
        entry.content.length > 1000 ? `${entry.content.slice(0, 1000)}…` : entry.content;
      return [`--- ${entry.title} ---`, clipped].join("\n");
    })
    .join("\n");
};

const buildPlannerPrompt = ({
  planDocs,
  recentSummaries,
}: {
  planDocs: string[];
  recentSummaries: string;
}): string => {
  const docList = planDocs.map((doc) => `- ${doc}`).join("\n");
  return [
    "You are the planner.",
    "Use the plan docs included below and create task packets in .clanker/tasks/.",
    "Task packets are JSON files. Keep tasks small and non-overlapping.",
    "If a task looks too large or risks running out of tokens, split it into smaller tasks.",
    "Handoff rules: tasks must be self-contained; include tests to run and done criteria in the prompt.",
    "Acceptance checklist: done criteria met, tests run + pass, risks noted.",
    formatTaskSchema(),
    "Status must start as 'queued'.",
    "Plan doc names:",
    docList || "(none)",
    "Plan docs + recent summaries:",
    recentSummaries,
  ].join("\n");
};

export const runPlan = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  const docsDir = join(repoRoot, "docs");
  let planDocs: string[] = [];
  try {
    const files = await readdir(docsDir);
    planDocs = files.filter((file) => file.startsWith("plan-") && file.endsWith(".md"));
  } catch {
    console.log("plan scan: no docs/ directory found");
    return;
  }

  const contextPack = await buildContextPack({ repoRoot, historyDir: paths.historyDir });
  const recentSummaries = formatContextEntries({ entries: contextPack.entries });
  const prompt = buildPlannerPrompt({ planDocs, recentSummaries });
  const promptSettings = getPromptSettings({ repoRoot, config });
  await mkdir(dirname(promptSettings.planPromptAbsolutePath), { recursive: true });
  await writeFile(promptSettings.planPromptAbsolutePath, prompt, "utf-8");

  const dispatchPrompt =
    promptSettings.mode === "file"
      ? buildPlanFileDispatch({ promptPath: promptSettings.planPromptPath })
      : prompt;

  const panes = await listPanes({ sessionName: config.tmuxFilter });
  const plannerPane =
    panes.find((pane) => pane.title === "clanker:planner") ??
    panes.find((pane) => pane.title === "planner");
  if (!plannerPane) {
    console.log("planner pane not found (title clanker:planner)");
    return;
  }

  await sendKeys({ paneId: plannerPane.paneId, text: dispatchPrompt });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "PLAN_SENT",
      msg: "sent plan prompt to planner",
      slaveId: "planner",
    },
  });

  console.log("plan prompt sent to planner");
};
