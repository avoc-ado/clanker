import { dirname, join } from "node:path";

export enum ClankerRole {
  Planner = "planner",
  Judge = "judge",
  Slave = "slave",
}

export const buildBasePrompt = ({
  role,
  paths,
}: {
  role: ClankerRole;
  paths: { tasksDir: string; historyDir: string };
}): string => {
  const stateDir = dirname(paths.tasksDir);
  switch (role) {
    case ClankerRole.Planner:
      return [
        "You are the clanker planner.",
        "Plan only; do not edit code or run tests.",
        "Create exactly one task packet per prompt.",
        "Create task packets via `clanker task add <id> --json` (prefer `--json` when needed).",
        "Keep tasks small, independent, and testable.",
        `Clanker state lives at ${stateDir} (repo root); avoid per-worktree .clanker dirs.`,
        `Inspect ${paths.tasksDir} and ${paths.historyDir} to avoid duplicates.`,
        "Fill in blanks: research code/docs/web; write findings to docs/research/.",
        "Include standard deps/config/testing flows for a well-tested product.",
        "Favor hard route, no shortcuts; modicum progress is valuable.",
        "Avoid churn: no meta-tasks, no speculative refactors.",
      ].join("\n");
    case ClankerRole.Slave:
      return [
        "You are a clanker slave.",
        "Execute the assigned task packet.",
        "Do not ask the user; make best-effort assumptions and note risks.",
        "Honor ownerDirs/ownerFiles in the task packet; avoid unrelated files.",
        "Run all listed tests; add missing tests when behavior changes.",
        "Commit your changes before needs_judge; include the commit in the handoff diffs.",
        "After committing, execute the status and handoff commands in the shell (do not only print them).",
        "If task is too large, mark blocked with split guidance for planner.",
        "Fill in blanks: standard deps/testing flows; no shortcuts.",
        "Update status: clanker task status <id> needs_judge|blocked|failed.",
        "Write handoff: clanker task handoff <id> slave --summary ... --tests ... --diffs ... --risks ...",
      ].join("\n");
    case ClankerRole.Judge:
      return [
        "You are a clanker judge.",
        "Review task output + handoff before marking done.",
        "Independent verification; do not implement features.",
        "Run listed tests; add missing verification when needed.",
        "Verify the slave commit provided in the prompt; checkout that commit before judging.",
        "Prefer rework when scope or tests are missing.",
        "Update status: clanker task status <id> done|rework|blocked|failed.",
        "Write handoff: clanker task handoff <id> judge --summary ... --tests ... --diffs ... --risks ...",
      ].join("\n");
    default: {
      const _exhaustiveCheck: never = role;
      return _exhaustiveCheck;
    }
  }
};

export const buildPlanFileDispatch = ({
  promptPath,
  tasksDir,
}: {
  promptPath: string;
  tasksDir: string;
}): string => {
  const stateDir = dirname(tasksDir);
  return [
    `Open ${promptPath} and follow it exactly.`,
    `Clanker state lives at ${stateDir} (repo root).`,
    "Create task packets via clanker task add <id> --json now.",
  ].join(" ");
};

export const buildTaskFileDispatch = ({
  taskId,
  tasksDir,
}: {
  taskId: string;
  tasksDir: string;
}): string =>
  `Open ${join(tasksDir, `${taskId}.json`)} and execute it. Follow the instructions exactly.`;

export const buildJudgeTaskDispatch = ({
  taskId,
  tasksDir,
  historyDir,
  title,
}: {
  taskId: string;
  tasksDir: string;
  historyDir: string;
  title?: string;
}): string => {
  const label = title ? `${taskId}: ${title}` : taskId;
  return [
    `Review task ${label}.`,
    `Task file: ${join(tasksDir, `${taskId}.json`)}`,
    `Handoff: ${join(historyDir, `task-${taskId}-slave.md`)}`,
  ].join("\n");
};

const normalizePromptLine = ({ line }: { line: string }): string => line.trim();

export const mergePromptSections = ({ sections }: { sections: string[] }): string => {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const section of sections) {
    for (const rawLine of section.split("\n")) {
      const line = normalizePromptLine({ line: rawLine });
      if (line.length === 0) {
        if (merged.length === 0 || merged[merged.length - 1] === "") {
          continue;
        }
        merged.push("");
        continue;
      }
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      merged.push(line);
    }
  }
  while (merged.length > 0 && merged[merged.length - 1] === "") {
    merged.pop();
  }
  return merged.join("\n");
};

export const buildJudgeRelaunchPrompt = ({
  tasks,
  tasksDir,
}: {
  tasks: { id: string; title?: string; status: string }[];
  tasksDir: string;
}): string | null => {
  const pending = tasks.filter((task) => task.status === "needs_judge");
  if (pending.length === 0) {
    return null;
  }
  const list = pending
    .map((task) => (task.title ? `- ${task.id}: ${task.title}` : `- ${task.id}`))
    .join("\n");
  return [
    "You are the judge.",
    `Review tasks marked needs_judge in ${tasksDir}.`,
    list ? `Current queue:\n${list}` : null,
    `For each task: open ${tasksDir}/<id>.json, validate changes, then set status to done/rework/blocked/failed via \`clanker task status <id> <status>\`.`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};
