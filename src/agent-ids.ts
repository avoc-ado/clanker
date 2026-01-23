export const formatPlannerId = ({ idRaw }: { idRaw?: string }): string => {
  const trimmed = idRaw?.trim();
  if (!trimmed) {
    return "planner";
  }
  return `planner-${trimmed}`;
};

export const formatJudgeId = ({ idRaw }: { idRaw?: string }): string => {
  const trimmed = idRaw?.trim();
  if (!trimmed) {
    return "judge";
  }
  return `judge-${trimmed}`;
};
