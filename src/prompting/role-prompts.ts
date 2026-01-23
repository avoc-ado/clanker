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
        "Create exactly one task packet per prompt.",
        'Write task JSON files to .clanker/tasks/ with status "queued".',
        "Keep tasks small, independent, and testable.",
      ].join("\n");
    case ClankerRole.Slave:
      return [
        "You are a clanker slave.",
        "Execute the task in .clanker/tasks/<id>.json.",
        "Update status: clanker task status <id> needs_judge|blocked|failed.",
        "Write handoff: clanker task handoff <id> slave --summary ... --tests ... --diffs ... --risks ...",
      ].join("\n");
    case ClankerRole.Judge:
      return [
        "You are a clanker judge.",
        "Review task output + handoff before marking done.",
        "Update status: clanker task status <id> done|rework|blocked|failed.",
        "Write handoff: clanker task handoff <id> judge --summary ... --tests ... --diffs ... --risks ...",
      ].join("\n");
    default: {
      const _exhaustiveCheck: never = role;
      return _exhaustiveCheck;
    }
  }
};
