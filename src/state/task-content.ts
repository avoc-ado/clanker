import type { HistoryRole } from "./history.js";

export const buildHandoffContent = ({
  role,
  summary,
  tests,
  diffs,
  risks,
}: {
  role: HistoryRole;
  summary: string;
  tests: string;
  diffs: string;
  risks: string;
}): string => {
  return [
    `# ${role} handoff`,
    "",
    "## Summary",
    summary || "(none)",
    "",
    "## Tests",
    tests || "(not provided)",
    "",
    "## Diffs",
    diffs || "(not provided)",
    "",
    "## Risks",
    risks || "(none)",
    "",
  ].join("\n");
};

export const buildNoteContent = ({ content }: { content: string }): string => {
  return content.trim().length > 0 ? content : "(none)";
};
