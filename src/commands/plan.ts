import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import { listPanes, sendKeys } from "../tmux.js";
import type { TmuxPane } from "../tmux.js";
import { formatTaskSchema } from "../plan/schema.js";
import { buildContextPack } from "../context/context-pack.js";
import { loadConfig } from "../config.js";
import { getPromptSettings } from "../prompting.js";
import {
  buildBasePrompt,
  buildPlanFileDispatch,
  ClankerRole,
  mergePromptSections,
} from "../prompting/role-prompts.js";
import { parsePlannerTitle } from "../tmux-title-utils.js";
import { getRepoRoot } from "../repo-root.js";

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

export const buildPlannerPrompt = ({
  planDocs,
  recentSummaries,
  tasksDir,
}: {
  planDocs: string[];
  recentSummaries: string;
  tasksDir: string;
}): string => {
  const docList = planDocs.map((doc) => `- ${doc}`).join("\n");
  return [
    `Use the plan docs included below and create task packets in ${tasksDir}.`,
    "Task packets are JSON files.",
    "If a task looks too large or risks running out of tokens, split it into smaller tasks.",
    "Clanker will re-prompt for more tasks as needed.",
    "Do not require clanker-specific commands inside the task prompt.",
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

export const selectPlannerPane = ({ panes }: { panes: TmuxPane[] }): TmuxPane | null => {
  const planners = panes
    .map((pane) => {
      const parsed = parsePlannerTitle({ title: pane.title });
      if (!parsed) {
        return null;
      }
      return {
        pane,
        isDefault: parsed.isDefault,
        id: parsed.id,
      };
    })
    .filter((entry): entry is { pane: TmuxPane; isDefault: boolean; id: string } => Boolean(entry));

  if (planners.length === 0) {
    return null;
  }

  planners.sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    const aNum = Number(a.id);
    const bNum = Number(b.id);
    const aIsNum = Number.isFinite(aNum);
    const bIsNum = Number.isFinite(bNum);
    if (aIsNum && bIsNum) {
      return aNum - bNum;
    }
    if (aIsNum !== bIsNum) {
      return aIsNum ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });

  return planners[0]?.pane ?? null;
};

export interface PlannerDispatchResult {
  promptPath: string;
  dispatched: boolean;
}

export const dispatchPlannerPrompt = async ({
  repoRoot,
  plannerPaneId,
}: {
  repoRoot?: string;
  plannerPaneId?: string | null;
}): Promise<PlannerDispatchResult | null> => {
  const resolvedRoot = repoRoot ?? getRepoRoot();
  const paths = getClankerPaths({ repoRoot: resolvedRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot: resolvedRoot });

  const docsDir = join(resolvedRoot, "docs");
  let planDocs: string[] = [];
  try {
    const files = await readdir(docsDir);
    planDocs = files.filter((file) => file.startsWith("plan-") && file.endsWith(".md"));
  } catch {
    return null;
  }

  const contextPack = await buildContextPack({
    repoRoot: resolvedRoot,
    historyDir: paths.historyDir,
  });
  const recentSummaries = formatContextEntries({ entries: contextPack.entries });
  const promptBody = buildPlannerPrompt({
    planDocs,
    recentSummaries,
    tasksDir: paths.tasksDir,
  });
  const prompt = mergePromptSections({
    sections: [
      buildBasePrompt({
        role: ClankerRole.Planner,
        paths: { tasksDir: paths.tasksDir, historyDir: paths.historyDir },
      }),
      promptBody,
    ],
  });
  const promptSettings = getPromptSettings({ repoRoot: resolvedRoot, config });
  await mkdir(dirname(promptSettings.planPromptAbsolutePath), { recursive: true });
  await writeFile(promptSettings.planPromptAbsolutePath, prompt, "utf-8");

  const dispatchPrompt =
    promptSettings.mode === "file"
      ? buildPlanFileDispatch({
          promptPath: promptSettings.planPromptAbsolutePath,
          tasksDir: paths.tasksDir,
        })
      : prompt;

  let targetPaneId = plannerPaneId ?? null;
  if (!targetPaneId) {
    const panes = await listPanes({ sessionPrefix: config.tmuxFilter });
    const plannerPane = selectPlannerPane({ panes });
    targetPaneId = plannerPane?.paneId ?? null;
  }

  if (targetPaneId) {
    await sendKeys({ paneId: targetPaneId, text: dispatchPrompt });
  }
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "PLAN_SENT",
      msg: "sent plan prompt to planner",
      slaveId: "planner-1",
    },
  });
  return { promptPath: promptSettings.planPromptPath, dispatched: Boolean(targetPaneId) };
};
