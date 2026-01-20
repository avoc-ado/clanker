import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

export const writeConfig = async ({
  root,
  stubPath,
}: {
  root: string;
  stubPath: string;
}): Promise<void> => {
  await writeFile(
    join(root, "clanker.yaml"),
    `slaves: 1\ntmuxSession: ""\ncodexCommand: "node ${stubPath}"\n`,
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
