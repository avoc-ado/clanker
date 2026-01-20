const SPARK_LEVELS = [" ", ".", ":", "-", "=", "+", "*", "#"] as const;

export const sparkline = ({ values }: { values: number[] }): string => {
  if (values.length === 0) {
    return "";
  }
  const max = Math.max(...values);
  if (max <= 0) {
    return values.map(() => SPARK_LEVELS[0]).join("");
  }
  return values
    .map((value) => {
      const ratio = value / max;
      const index = Math.min(SPARK_LEVELS.length - 1, Math.floor(ratio * (SPARK_LEVELS.length - 1)));
      return SPARK_LEVELS[index];
    })
    .join("");
};
