import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const hasBinary = async ({ name }: { name: string }): Promise<boolean> => {
  try {
    await execFileAsync("command", ["-v", name], { shell: true });
    return true;
  } catch {
    return false;
  }
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
  const envOverride = process.env.CLANKER_CODEX_COMMAND;
  const command = envOverride && envOverride.trim().length > 0 ? envOverride : override;
  if (command && command.trim().length > 0) {
    const parts = splitCommand({ command });
    const [cmd, ...args] = parts;
    return { cmd: cmd ?? "codex", args };
  }
  const hasC = await hasBinary({ name: "c" });
  return { cmd: hasC ? "c" : "codex", args: [] };
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
  if (process.env.CLANKER_DISABLE_CODEX === "1") {
    logStream.write("codex disabled\n");
    logStream.end();
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    return { child, logPath };
  }

  const cli = await resolveCliCommand({ override: command });

  const child = spawn(cli.cmd, cli.args, { stdio: ["inherit", "pipe", "pipe"] });
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
