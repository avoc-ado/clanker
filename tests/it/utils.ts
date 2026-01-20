import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const execFileAsync = promisify(execFile);

const repoRoot = resolve(process.cwd());
const cliPath = join(repoRoot, "dist", "cli.js");
const pnpRequire = join(repoRoot, ".pnp.cjs");
const pnpLoader = join(repoRoot, ".pnp.loader.mjs");

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
  const pnpOptions = `--require ${pnpRequire} --loader ${pnpLoader}`;
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
    return "c --help";
  }
  if (await hasBinary({ name: "codex" })) {
    return "codex --help";
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
