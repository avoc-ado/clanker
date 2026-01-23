import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { getRuntimeOverrides } from "../runtime/overrides.js";

const YARN_LOG_LINE_REGEX = /^(?:\s*➤\s*)?YN\d{4}:/;
const YARN_INSTALL_LINE_REGEX = /\byarn install\b/i;

export const shouldSuppressYarnInstallLine = ({ line }: { line: string }): boolean => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return YARN_LOG_LINE_REGEX.test(trimmed) || YARN_INSTALL_LINE_REGEX.test(trimmed);
};

const attachFilteredPipe = ({
  source,
  target,
  logStream,
}: {
  source: NodeJS.ReadableStream | null | undefined;
  target: NodeJS.WriteStream;
  logStream: NodeJS.WritableStream;
}): { flush: () => void } => {
  let buffer = "";
  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    const pending = buffer;
    buffer = "";
    if (!shouldSuppressYarnInstallLine({ line: pending })) {
      target.write(pending);
    }
  };
  if (!source) {
    return { flush };
  }
  source.on("data", (chunk) => {
    const text = buffer + chunk.toString("utf-8");
    const lines = text.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const hasCarriageReturn = line.endsWith("\r");
      const outputLine = hasCarriageReturn ? line.slice(0, -1) : line;
      const newline = hasCarriageReturn ? "\r\n" : "\n";
      if (!shouldSuppressYarnInstallLine({ line: outputLine })) {
        target.write(outputLine + newline);
      }
    }
    logStream.write(chunk);
  });
  source.on("end", () => {
    flush();
  });
  return { flush };
};

const splitCommand = ({ command }: { command: string }): string[] => {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let isEscaping = false;
  for (const ch of command.trim()) {
    if (isEscaping) {
      current += ch;
      isEscaping = false;
      continue;
    }
    if (ch === "\\") {
      isEscaping = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
};

const resolveCliCommand = async ({
  override,
}: {
  override?: string;
}): Promise<{ cmd: string; args: string[] }> => {
  const command = override;
  if (command && command.trim().length > 0) {
    const parts = splitCommand({ command });
    const [cmd, ...args] = parts;
    return { cmd: cmd ?? "codex", args };
  }
  return { cmd: "codex", args: [] };
};

const wrapWithPty = ({
  cmd,
  args,
}: {
  cmd: string;
  args: string[];
}): { cmd: string; args: string[] } => {
  return {
    cmd: "script",
    args: ["-q", "/dev/null", cmd, ...args],
  };
};

const makeLogPath = ({
  logsDir,
  role,
  id,
}: {
  logsDir: string;
  role: string;
  id: string;
}): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(logsDir, `${role}-${id}-${stamp}.log`);
};

export const spawnCodex = async ({
  logsDir,
  role,
  id,
  command,
}: {
  logsDir: string;
  role: string;
  id: string;
  command?: string;
}): Promise<{ child: ReturnType<typeof spawn>; logPath: string }> => {
  const logPath = makeLogPath({ logsDir, role, id });
  const logStream = createWriteStream(logPath, { flags: "a" });
  const overrides = getRuntimeOverrides();
  if (overrides.disableCodex) {
    logStream.write("codex disabled\n");
    logStream.end();
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    return { child, logPath };
  }

  const cli = await resolveCliCommand({ override: command });
  const usePty = Boolean(overrides.codexTty);
  const finalCli = usePty ? wrapWithPty(cli) : cli;

  const child = spawn(finalCli.cmd, finalCli.args, { stdio: ["pipe", "pipe", "pipe"] });
  if (child.stdin) {
    const handleData = (chunk: Buffer): void => {
      if (child.stdin?.writable) {
        child.stdin.write(chunk);
      }
    };
    process.stdin.on("data", handleData);
    process.stdin.resume();
    const cleanup = (): void => {
      process.stdin.off("data", handleData);
    };
    child.on("exit", cleanup);
    child.on("close", cleanup);
  }
  const stdoutPipe = attachFilteredPipe({
    source: child.stdout,
    target: process.stdout,
    logStream,
  });
  const stderrPipe = attachFilteredPipe({
    source: child.stderr,
    target: process.stderr,
    logStream,
  });
  child.on("exit", () => {
    stdoutPipe.flush();
    stderrPipe.flush();
    logStream.end();
  });

  return { child, logPath };
};
