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

const resolveCliCommand = async ({ override }: { override?: string }): Promise<{ cmd: string; args: string[] }> => {
  if (override && override.trim().length > 0) {
    const parts = override.trim().split(/\s+/);
    const [cmd, ...args] = parts;
    return { cmd: cmd ?? "codex", args };
  }
  const hasC = await hasBinary({ name: "c" });
  return { cmd: hasC ? "c" : "codex", args: [] };
};

const makeLogPath = ({ logsDir, role, id }: { logsDir: string; role: string; id: string }): string => {
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
  const cli = await resolveCliCommand({ override: command });
  const logPath = makeLogPath({ logsDir, role, id });
  const logStream = createWriteStream(logPath, { flags: "a" });

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
