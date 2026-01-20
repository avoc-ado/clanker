import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);

const repoRoot = resolve(process.cwd());
const cliPath = join(repoRoot, "dist", "cli.js");
const defaultPnpRequire = join(repoRoot, ".pnp.cjs");
const defaultPnpLoader = join(repoRoot, ".pnp.loader.mjs");
const yarnRcPath = join(repoRoot, ".yarnrc.yml");
const yarnLockPath = join(repoRoot, "yarn.lock");
const yarnCacheDir = join(repoRoot, ".yarn", "cache");

const resolveYarnReleasePath = async (): Promise<string> => {
  const raw = await readFile(yarnRcPath, "utf-8");
  const match = raw.match(/yarnPath:\s*(.+)/);
  if (!match || !match[1]) {
    return join(repoRoot, ".yarn", "releases", "yarn-4.12.0.cjs");
  }
  return join(repoRoot, match[1].trim());
};

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

const resolveRealCodexCommand = async (): Promise<string | null> => {
  const override = process.env.CLANKER_IT_REAL_COMMAND?.trim();
  if (override && override.length > 0) {
    return override;
  }
  if (await hasBinary({ name: "c" })) {
    return 'c "clanker it real mode: reply with OK and then stay idle"';
  }
  if (await hasBinary({ name: "codex" })) {
    return 'codex "clanker it real mode: reply with OK and then stay idle"';
  }
  return null;
};

const promptInstallCodex = async (): Promise<boolean> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "missing codex CLI (c or codex). Install with `npm i -g @openai/codex` or set CLANKER_IT_REAL_COMMAND.",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("codex not found. Install now? (y/N) ");
  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
};

const installCodex = async (): Promise<void> => {
  await execFileAsync("npm", ["i", "-g", "@openai/codex"], { stdio: "inherit" });
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
  let command = await resolveRealCodexCommand();
  if (!command) {
    const shouldInstall = await promptInstallCodex();
    if (!shouldInstall) {
      throw new Error("missing codex CLI (c or codex) for CLANKER_IT_MODE=real");
    }
    await installCodex();
    command = await resolveRealCodexCommand();
    if (!command) {
      throw new Error("codex install failed; command still missing");
    }
  }
  return { codexCommand: command };
};

export const writeConfig = async ({
  root,
  codexCommand,
}: {
  root: string;
  codexCommand: string;
}): Promise<void> => {
  const safeCommand = codexCommand.replace(/"/g, '\\"');
  await writeFile(
    join(root, "clanker.yaml"),
    `slaves: 1\ntmuxSession: ""\ncodexCommand: "${safeCommand}"\n`,
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

export const runNodeWithPnp = async ({
  cwd,
  args,
  env,
  pnpRoot,
}: {
  cwd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  pnpRoot?: string;
}): Promise<string> => {
  const pnpRequire = pnpRoot ? join(pnpRoot, ".pnp.cjs") : defaultPnpRequire;
  const pnpLoader = pnpRoot ? join(pnpRoot, ".pnp.loader.mjs") : defaultPnpLoader;
  const baseOptions = env?.NODE_OPTIONS ?? (pnpRoot ? "" : (process.env.NODE_OPTIONS ?? ""));
  const pnpOptions = `--require ${pnpRequire} --loader ${pnpLoader}`;
  const nodeOptions = `${baseOptions} ${pnpOptions}`.trim();
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    NODE_OPTIONS: nodeOptions,
  };
  const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd, env: mergedEnv });
  return `${stdout}${stderr}`.trim();
};

export const packWorkspace = async ({ outDir }: { outDir: string }): Promise<string> => {
  await mkdir(outDir, { recursive: true });
  const tarPath = join(outDir, "clanker-cli.tgz");
  await execFileAsync("yarn", ["pack", "-o", tarPath], { cwd: repoRoot });
  return tarPath;
};

export const extractTarball = async ({
  tarPath,
  outDir,
}: {
  tarPath: string;
  outDir: string;
}): Promise<string> => {
  await mkdir(outDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarPath, "-C", outDir]);
  return join(outDir, "package");
};

export const installPackedDeps = async ({ pkgRoot }: { pkgRoot: string }): Promise<void> => {
  await copyFile(yarnRcPath, join(pkgRoot, ".yarnrc.yml"));
  await copyFile(yarnLockPath, join(pkgRoot, "yarn.lock"));
  const releasePath = await resolveYarnReleasePath();
  const releaseDir = join(pkgRoot, ".yarn", "releases");
  await mkdir(releaseDir, { recursive: true });
  const releaseName = basename(releasePath);
  await copyFile(releasePath, join(releaseDir, releaseName));
  await execFileAsync(process.execPath, [join(releaseDir, releaseName), "install", "--immutable"], {
    cwd: pkgRoot,
    env: {
      ...process.env,
      YARN_CACHE_FOLDER: yarnCacheDir,
      YARN_ENABLE_NETWORK: "0",
    },
  });
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
