export const formatPlannerId = ({ idRaw }: { idRaw?: string }): string => {
  const trimmed = idRaw?.trim();
  if (!trimmed) {
    return "planner-1";
  }
  return `planner-${trimmed}`;
};

export const formatJudgeId = ({ idRaw }: { idRaw?: string }): string => {
  const trimmed = idRaw?.trim();
  if (!trimmed) {
    return "judge-1";
  }
  return `judge-${trimmed}`;
};

export const formatSlaveId = ({ idRaw }: { idRaw?: string }): string => {
  const trimmed = idRaw?.trim();
  if (!trimmed) {
    return "slave-1";
  }
  return `slave-${trimmed}`;
};
