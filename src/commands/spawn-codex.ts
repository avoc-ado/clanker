import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { getRuntimeOverrides } from "../runtime/overrides.js";
import { attachFilteredPipe, wireStdin } from "../codex/process-io.js";

const attachRawPipe = ({
  source,
  target,
  logStream,
}: {
  source: NodeJS.ReadableStream | null | undefined;
  target: NodeJS.WriteStream;
  logStream: NodeJS.WritableStream;
}): { flush: () => void } => {
  if (!source) {
    return { flush: () => {} };
  }
  source.on("data", (chunk) => {
    target.write(chunk);
    logStream.write(chunk);
  });
  return { flush: () => {} };
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
  cwd,
}: {
  logsDir: string;
  role: string;
  id: string;
  command?: string;
  cwd?: string;
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
  const stdio: ["pipe" | "inherit", "pipe", "pipe"] = usePty
    ? ["inherit", "pipe", "pipe"]
    : ["pipe", "pipe", "pipe"];
  const child = spawn(finalCli.cmd, finalCli.args, { stdio, cwd });
  wireStdin({ child });
  const attachPipe = usePty ? attachRawPipe : attachFilteredPipe;
  const stdoutPipe = attachPipe({
    source: child.stdout,
    target: process.stdout,
    logStream,
  });
  const stderrPipe = attachPipe({
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
