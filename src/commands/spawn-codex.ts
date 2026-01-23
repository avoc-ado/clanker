import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { getRuntimeOverrides } from "../runtime/overrides.js";

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
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });
  child.on("exit", () => {
    logStream.end();
  });

  return { child, logPath };
};
