export const normalizePaneTitle = ({ title }: { title: string }): string => {
  return title.startsWith("clanker:") ? title.slice("clanker:".length) : title;
};

const parseRoleTitle = ({
  title,
  role,
}: {
  title: string;
  role: "planner" | "judge";
}): { id: string; isDefault: boolean } | null => {
  const normalized = normalizePaneTitle({ title });
  const match = new RegExp(`^${role}(?:-(.+))?$`).exec(normalized);
  if (!match) {
    return null;
  }
  const id = match[1] ?? "1";
  return { id, isDefault: id === "1" };
};

export const parsePlannerTitle = ({
  title,
}: {
  title: string;
}): { id: string; isDefault: boolean } | null => {
  return parseRoleTitle({ title, role: "planner" });
};

export const parseJudgeTitle = ({
  title,
}: {
  title: string;
}): { id: string; isDefault: boolean } | null => {
  return parseRoleTitle({ title, role: "judge" });
};

export const extractSlaveId = ({ title }: { title: string }): string | null => {
  const normalized = normalizePaneTitle({ title });
  if (/^slave-\d+$/.test(normalized)) {
    return normalized;
  }
  return null;
};
