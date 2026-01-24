export enum ClankerRole {
  Planner = "planner",
  Judge = "judge",
  Slave = "slave",
}

export const buildBasePrompt = ({ role }: { role: ClankerRole }): string => {
  switch (role) {
    case ClankerRole.Planner:
      return [
        "You are the clanker planner.",
        "Plan only; do not edit code or run tests.",
        "Create exactly one task packet per prompt.",
        'Write task JSON files to .clanker/tasks/ with status "queued".',
        "Keep tasks small, independent, and testable.",
        "Inspect .clanker/tasks and .clanker/history to avoid duplicates.",
        "Fill in blanks: research code/docs/web; write findings to docs/research/.",
        "Include standard deps/config/testing flows for a well-tested product.",
        "Favor hard route, no shortcuts; modicum progress is valuable.",
        "Avoid churn: no meta-tasks, no speculative refactors.",
      ].join("\n");
    case ClankerRole.Slave:
      return [
        "You are a clanker slave.",
        "Execute the task in .clanker/tasks/<id>.json.",
        "Do not ask the user; make best-effort assumptions and note risks.",
        "Honor ownerDirs/ownerFiles in the task packet; avoid unrelated files.",
        "Run all listed tests; add missing tests when behavior changes.",
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

export const buildPlanFileDispatch = ({ promptPath }: { promptPath: string }): string =>
  `Open ${promptPath} and follow it exactly. Create task packets in .clanker/tasks now.`;

export const buildTaskFileDispatch = ({ taskId }: { taskId: string }): string =>
  `Open .clanker/tasks/${taskId}.json and execute it. Follow the instructions exactly.`;

export const buildJudgeRelaunchPrompt = ({
  tasks,
}: {
  tasks: { id: string; title?: string; status: string }[];
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
    "Review tasks marked needs_judge in .clanker/tasks.",
    list ? `Current queue:\n${list}` : null,
    "For each task: open .clanker/tasks/<id>.json, validate changes, then set status to done/rework/blocked/failed via `clanker task status <id> <status>`.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};
