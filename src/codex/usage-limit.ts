const USAGE_LIMIT_PATTERNS = [
  /you['’]ve hit your usage limit/i,
  /you have hit your usage limit/i,
  /\b(hit|reached|exceeded)\b.{0,40}\busage limit\b/i,
  /\busage limit\b/i,
];

export const isUsageLimitLine = ({ line }: { line: string }): boolean => {
  if (!line || line.trim().length === 0) {
    return false;
  }
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(line));
};

export const hasUsageLimitContent = ({ content }: { content: string }): boolean => {
  return content.split(/\r?\n/).some((line) => isUsageLimitLine({ line }));
};
