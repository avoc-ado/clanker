import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);

const repoRoot = resolve(process.cwd());
const cliPath = join(repoRoot, "dist", "cli.js");
const defaultPnpRequire = join(repoRoot, ".pnp.cjs");
const defaultPnpLoader = join(repoRoot, ".pnp.loader.mjs");

export const runCli = async ({
  cwd,
  args,
  env,
}: {
  cwd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<string> => {
  const baseOptions = env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? "";
  const pnpOptions = `--require ${defaultPnpRequire} --loader ${defaultPnpLoader}`;
  const nodeOptions = `${baseOptions} ${pnpOptions}`.trim();
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    NODE_OPTIONS: nodeOptions,
  };
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: mergedEnv,
  });
  return `${stdout}${stderr}`.trim();
};

type CodexMode = "stub" | "real";

const getCodexMode = (): CodexMode => {
  const mode = (process.env.CLANKER_IT_MODE ?? "stub").trim().toLowerCase();
  return mode === "real" ? "real" : "stub";
};

export const isRealMode = (): boolean => getCodexMode() === "real";

const hasBinary = async ({ name }: { name: string }): Promise<boolean> => {
  try {
    await execFileAsync("command", ["-v", name], { shell: true });
    return true;
  } catch {
    return false;
  }
};

const resolveBinaryPath = async ({ name }: { name: string }): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("command", ["-v", name], { shell: true });
    const resolved = stdout.trim();
    return resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
};

export const ensureTmuxInstalled = async (): Promise<void> => {
  if (!(await hasBinary({ name: "tmux" }))) {
    throw new Error("missing tmux (install with `brew install tmux`)");
  }
};

export const ensureCodexInstalled = async (): Promise<void> => {
  if (process.env.CLANKER_IT_REAL_COMMAND?.trim()) {
    return;
  }
  if (!(await hasBinary({ name: "codex" }))) {
    throw new Error("missing codex CLI (install with `npm i -g @openai/codex`)");
  }
};

const resolveRealCodexCommand = async (): Promise<string | null> => {
  const override = process.env.CLANKER_IT_REAL_COMMAND?.trim();
  if (override && override.length > 0) {
    return override;
  }
  const codexPath = await resolveBinaryPath({ name: "codex" });
  if (codexPath) {
    return [codexPath, "-a", "never", "--sandbox", "workspace-write", "--no-alt-screen"].join(" ");
  }
  return null;
};

export const makeTmpRepo = async ({ planLines }: { planLines: string[] }): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "clanker-it-"));
  const docsDir = join(root, "docs");
  await mkdir(docsDir, { recursive: true });
  await writeFile(join(docsDir, "plan-it.md"), planLines.join("\n"), "utf-8");
  return root;
};

export const writeCodexStub = async ({ root }: { root: string }): Promise<string> => {
  const stubPath = join(root, "codex-stub.mjs");
  await writeFile(
    stubPath,
    [
      "const input = process.argv.slice(2).join(' ');",
      "if (input.includes('--echo')) {",
      "  console.log('echo:' + input.replace('--echo', '').trim());",
      "} else {",
      "  console.log('stub');",
      "}",
    ].join("\n"),
    "utf-8",
  );
  return stubPath;
};

export const resolveCodexCommand = async ({
  root,
}: {
  root: string;
}): Promise<{ codexCommand: string; stubPath?: string }> => {
  const mode = getCodexMode();
  if (mode === "stub") {
    const stubPath = await writeCodexStub({ root });
    return { codexCommand: `node ${stubPath}`, stubPath };
  }
  const command = await resolveRealCodexCommand();
  if (!command) {
    throw new Error("missing codex CLI for CLANKER_IT_MODE=real");
  }
  return { codexCommand: command };
};

export const initGitRepo = async ({ root }: { root: string }): Promise<void> => {
  try {
    await execFileAsync("git", ["init"], { cwd: root });
  } catch (error) {
    throw new Error(`missing git for real integration tests: ${String(error)}`);
  }
};

export const setupRealMode = async ({ root }: { root: string }): Promise<void> => {
  await ensureCodexInstalled();
  await initGitRepo({ root });
  const tmuxDir = join(repoRoot, ".clanker", "tmux-it", basename(root));
  await mkdir(tmuxDir, { recursive: true });
  process.env.CLANKER_TMUX_SOCKET = join(tmuxDir, "socket");
};

export const writeConfig = async ({
  root,
  codexCommand,
  tmuxSession,
  promptFile,
}: {
  root: string;
  codexCommand: string;
  tmuxSession?: string;
  promptFile?: string;
}): Promise<void> => {
  const safeCommand = codexCommand.replace(/"/g, '\\"');
  const sessionLine = tmuxSession ? `tmuxSession: "${tmuxSession}"\n` : "";
  const promptLine = promptFile ? `promptFile: "${promptFile.replace(/"/g, '\\"')}"\n` : "";
  await writeFile(
    join(root, "clanker.yaml"),
    `slaves: 1\n${sessionLine}${promptLine}codexCommand: "${safeCommand}"\n`,
    "utf-8",
  );
};

export const ensureExists = async ({
  path,
  label,
}: {
  path: string;
  label: string;
}): Promise<void> => {
  try {
    await readFile(path, "utf-8");
  } catch {
    throw new Error(`missing ${label}: ${path}`);
  }
};

export const runNode = async ({ cwd, args }: { cwd: string; args: string[] }): Promise<string> => {
  const { stdout, stderr } = await execFileAsync("node", args, { cwd });
  return `${stdout}${stderr}`.trim();
};

export const runCliInteractive = async ({
  cwd,
  args,
  env,
  inputLines,
  timeoutMs,
  usePty,
}: {
  cwd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  inputLines: string[];
  timeoutMs: number;
  usePty?: boolean;
}): Promise<{ stdout: string; stderr: string; timedOut: boolean }> => {
  const baseOptions = env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? "";
  const pnpOptions = `--require ${defaultPnpRequire} --loader ${defaultPnpLoader}`;
  const nodeOptions = `${baseOptions} ${pnpOptions}`.trim();
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    NODE_OPTIONS: nodeOptions,
  };
  const child = usePty
    ? spawn("script", ["-q", "/dev/null", process.execPath, cliPath, ...args], {
        cwd,
        env: mergedEnv,
        stdio: ["pipe", "pipe", "pipe"],
      })
    : spawn(process.execPath, [cliPath, ...args], {
        cwd,
        env: mergedEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await delay(500);
  child.stdin.write(`${inputLines.join("\n")}\n`);

  const exitPromise = new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
  });
  const timeoutPromise = delay(timeoutMs).then(() => "timeout" as const);
  const winner = await Promise.race([exitPromise.then(() => "exit" as const), timeoutPromise]);
  if (winner === "timeout") {
    child.kill("SIGTERM");
    await delay(500);
    child.kill("SIGKILL");
    await Promise.race([exitPromise, delay(1000)]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), timedOut: true };
  }
  return { stdout: stdout.trim(), stderr: stderr.trim(), timedOut: false };
};

export const runTmux = async ({ args }: { args: string[] }): Promise<string> => {
  const socket = process.env.CLANKER_TMUX_SOCKET?.trim();
  const baseArgs = socket ? ["-S", socket, ...args] : args;
  const { stdout } = await execFileAsync("tmux", baseArgs);
  return stdout.trim();
};

export const killTmuxSession = async ({ session }: { session: string }): Promise<void> => {
  try {
    await runTmux({ args: ["kill-session", "-t", session] });
  } catch {
    // ignore
  }
};

export const waitFor = async ({
  label,
  timeoutMs,
  intervalMs,
  check,
}: {
  label: string;
  timeoutMs: number;
  intervalMs: number;
  check: () => Promise<boolean>;
}): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) {
      return;
    }
    await delay(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
};

export const getCliPath = (): string => cliPath;
