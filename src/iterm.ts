import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const escapeAppleScript = ({ value }: { value: string }): string => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const escapeShellArg = ({ value }: { value: string }): string => {
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildCommand = ({ cwd, command }: { cwd: string; command: string }): string => {
  const cd = `cd ${escapeShellArg({ value: cwd })}`;
  return `${cd}; ${command}`;
};

export const buildGridLayout = ({
  paneCount,
  maxRows = 2,
}: {
  paneCount: number;
  maxRows?: number;
}): { columns: string[][]; maxRows: number } => {
  const columnsCount = Math.ceil(paneCount / maxRows);
  const rowsPerColumn: number[] = [];
  let remaining = paneCount;
  for (let col = 0; col < columnsCount; col += 1) {
    const rowsForColumn = Math.min(maxRows, remaining);
    rowsPerColumn.push(rowsForColumn);
    remaining -= rowsForColumn;
  }
  const columns = rowsPerColumn.map((rows) => new Array(rows).fill(""));
  return { columns, maxRows };
};

export const buildItermScript = ({
  cwd,
  commands,
}: {
  cwd: string;
  commands: string[];
}): string[] => {
  const paneCount = commands.length;
  const { columns, maxRows } = buildGridLayout({ paneCount });
  const columnCount = columns.length;
  const lines: string[] = [
    'tell application "iTerm"',
    "  activate",
    "  set newWindow to (create window with default profile)",
    "  set desktopBounds to {0, 0, 0, 0}",
    "  try",
    '    tell application "Finder" to set desktopBounds to bounds of window of desktop',
    "  end try",
    "  if item 3 of desktopBounds is greater than 0 then",
    "    set bounds of newWindow to desktopBounds",
    "  end if",
    "  tell newWindow",
    "    set session1 to current session of current tab",
  ];

  let sessionIndex = 1;
  const topSessions: string[] = ["session1"];
  for (let col = 1; col < columnCount; col += 1) {
    const previous = topSessions[col - 1];
    sessionIndex += 1;
    const name = `session${sessionIndex}`;
    lines.push(`    set ${name} to split vertically with default profile of ${previous}`);
    topSessions.push(name);
  }

  const columnSessions: string[][] = [];
  for (let col = 0; col < columnCount; col += 1) {
    const rows = columns[col].length;
    const stack: string[] = [topSessions[col]];
    for (let row = 1; row < rows; row += 1) {
      const base = stack[row - 1];
      sessionIndex += 1;
      const name = `session${sessionIndex}`;
      lines.push(`    set ${name} to split horizontally with default profile of ${base}`);
      stack.push(name);
    }
    columnSessions.push(stack);
  }

  const sessionsOrdered: string[] = [];
  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < columnCount; col += 1) {
      if (row < columnSessions[col].length) {
        sessionsOrdered.push(columnSessions[col][row]);
      }
    }
  }

  const commandLines = commands.map((command) =>
    escapeAppleScript({ value: buildCommand({ cwd, command }) }),
  );
  for (const [index, command] of commandLines.entries()) {
    const session = sessionsOrdered[index] as string;
    lines.push(`    tell ${session} to write text "${command}"`);
  }

  lines.push("  end tell");
  lines.push("end tell");
  return lines;
};

export const launchIterm = async ({
  cwd,
  commands,
}: {
  cwd: string;
  commands: string[];
}): Promise<void> => {
  try {
    await execFileAsync("osascript", ["-e", 'tell application "iTerm" to version']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `iTerm2 is required on macOS; install it or run with --tmux (details: ${message})`,
    );
  }
  const script = buildItermScript({ cwd, commands });
  await execFileAsync(
    "osascript",
    script.flatMap((line) => ["-e", line]),
  );
};
