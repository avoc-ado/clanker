const formatRoleId = ({
  idRaw,
  role,
}: {
  idRaw?: string;
  role: "planner" | "judge" | "slave";
}): string => {
  const trimmed = idRaw?.trim();
  if (!trimmed) {
    return `${role}-1`;
  }
  const prefix = `${role}-`;
  const normalized = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  return `${role}-${normalized}`;
};

export const formatPlannerId = ({ idRaw }: { idRaw?: string }): string =>
  formatRoleId({ idRaw, role: "planner" });

export const formatJudgeId = ({ idRaw }: { idRaw?: string }): string =>
  formatRoleId({ idRaw, role: "judge" });

export const formatSlaveId = ({ idRaw }: { idRaw?: string }): string =>
  formatRoleId({ idRaw, role: "slave" });
