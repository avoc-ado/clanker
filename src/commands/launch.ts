import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadState, saveState } from "../state/state.js";
import { appendEvent } from "../state/events.js";
import { runTmux } from "../tmux.js";
import { runOnboardingIfNeeded } from "./onboarding.js";
import { launchIterm } from "../iterm.js";

interface PaneSpec {
  title: string;
  args: string[];
  usesCodex: boolean;
}

const applySessionOptions = async ({
  sessionName,
  hideStatus,
}: {
  sessionName: string;
  hideStatus?: boolean;
}): Promise<void> => {
  await runTmux({ args: ["set-window-option", "-t", sessionName, "allow-rename", "off"] });
  await runTmux({ args: ["set-window-option", "-t", sessionName, "automatic-rename", "off"] });
  await runTmux({ args: ["set-option", "-t", sessionName, "set-titles", "off"] });
  if (hideStatus) {
    await runTmux({ args: ["set-option", "-t", sessionName, "status", "off"] });
  }
};

const hasSession = async ({ sessionName }: { sessionName: string }): Promise<boolean> => {
  try {
    await runTmux({ args: ["has-session", "-t", sessionName] });
    return true;
  } catch {
    return false;
  }
};

const resolveCliPath = async ({ repoRoot }: { repoRoot: string }): Promise<string> => {
  const distPath = join(repoRoot, "dist", "cli.js");
  try {
    await stat(distPath);
    return distPath;
  } catch {
    return process.argv[1] ?? distPath;
  }
};

const findPnpRoot = async ({ startPath }: { startPath: string }): Promise<string | null> => {
  let current = startPath;
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(current, ".pnp.cjs");
    try {
      await stat(candidate);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return null;
};

const resolvePnpArgs = async ({ cliPath }: { cliPath: string }): Promise<string[]> => {
  const pnpRoot = await findPnpRoot({ startPath: dirname(cliPath) });
  if (!pnpRoot) {
    return [];
  }
  const pnpPath = join(pnpRoot, ".pnp.cjs");
  const loaderPath = join(pnpRoot, ".pnp.loader.mjs");
  try {
    await stat(pnpPath);
  } catch {
    return [];
  }
  const args = ["--require", pnpPath];
  try {
    await stat(loaderPath);
    args.push("--loader", loaderPath);
  } catch {
    // ignore missing loader
  }
  return args;
};

const listPaneIds = async ({ sessionName }: { sessionName: string }): Promise<string[]> => {
  const output = await runTmux({
    args: ["list-panes", "-t", `${sessionName}:0`, "-F", "#{pane_index}\t#{pane_id}"],
  });
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [indexRaw, paneId] = line.split("\t");
      return { index: Number(indexRaw), paneId: paneId ?? "" };
    })
    .filter((entry) => Number.isFinite(entry.index) && entry.paneId.length > 0)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.paneId);
};

const listWindowPaneId = async ({
  sessionName,
  windowIndex,
}: {
  sessionName: string;
  windowIndex: number;
}): Promise<string | null> => {
  try {
    const output = await runTmux({
      args: ["list-panes", "-t", `${sessionName}:${windowIndex}`, "-F", "#{pane_id}"],
    });
    const paneId = output.split("\n")[0]?.trim();
    return paneId && paneId.length > 0 ? paneId : null;
  } catch {
    return null;
  }
};

const createLayout = async ({
  sessionName,
  cwd,
  paneCount,
}: {
  sessionName: string;
  cwd: string;
  paneCount: number;
}): Promise<string[]> => {
  await runTmux({
    args: ["new-session", "-d", "-s", sessionName, "-n", "clanker", "-c", cwd],
  });
  await applySessionOptions({ sessionName });
  await runTmux({
    args: ["set-window-option", "-t", `${sessionName}:0`, "pane-min-height", "1"],
  });
  await runTmux({
    args: ["set-window-option", "-t", `${sessionName}:0`, "pane-min-width", "1"],
  });

  for (let i = 1; i < paneCount; i += 1) {
    try {
      await runTmux({ args: ["split-window", "-t", `${sessionName}:0`, "-c", cwd] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("no space for new pane")) {
        throw new Error(
          `tmux window too small for ${paneCount} panes; resize terminal or lower planners/judges/slaves`,
        );
      }
      throw error;
    }
  }
  await runTmux({ args: ["select-layout", "-t", `${sessionName}:0`, "tiled"] });
  return listPaneIds({ sessionName });
};

const createWindowedLayout = async ({
  sessionName,
  cwd,
  specs,
  hideStatus,
}: {
  sessionName: string;
  cwd: string;
  specs: PaneSpec[];
  hideStatus?: boolean;
}): Promise<string[]> => {
  const firstName = specs[0]?.title ?? "clanker";
  await runTmux({
    args: ["new-session", "-d", "-s", sessionName, "-n", firstName, "-c", cwd],
  });
  await applySessionOptions({ sessionName, hideStatus });
  const paneIds: string[] = [];
  const firstPaneId = await listWindowPaneId({ sessionName, windowIndex: 0 });
  if (firstPaneId) {
    paneIds.push(firstPaneId);
  }
  for (let i = 1; i < specs.length; i += 1) {
    const title = specs[i]?.title ?? `clanker-${i + 1}`;
    await runTmux({ args: ["new-window", "-t", sessionName, "-n", title, "-c", cwd] });
    const paneId = await listWindowPaneId({ sessionName, windowIndex: i });
    if (paneId) {
      paneIds.push(paneId);
    }
  }
  return paneIds;
};

const attachSession = async ({ sessionName }: { sessionName: string }): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tmux", ["attach-session", "-t", sessionName], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tmux attach failed (${code ?? "unknown"})`));
      }
    });
  });
};

const buildPaneSpecs = ({
  planners,
  judges,
  slaves,
}: {
  planners: number;
  judges: number;
  slaves: number;
}): PaneSpec[] => {
  const specs: PaneSpec[] = [{ title: "dashboard", args: ["dashboard"], usesCodex: false }];
  for (let i = 1; i <= planners; i += 1) {
    const suffix = i === 1 ? "" : `${i}`;
    const args = i === 1 ? ["planner"] : ["planner", `${i}`];
    specs.push({ title: `planner${suffix}`, args, usesCodex: true });
  }
  for (let i = 1; i <= judges; i += 1) {
    const suffix = i === 1 ? "" : `${i}`;
    const args = i === 1 ? ["judge"] : ["judge", `${i}`];
    specs.push({ title: `judge${suffix}`, args, usesCodex: true });
  }
  for (let i = 1; i <= slaves; i += 1) {
    specs.push({ title: `c${i}`, args: ["slave", `${i}`], usesCodex: true });
  }
  return specs;
};

const escapeShellArg = ({ value }: { value: string }): string => {
  return `'${value.replace(/'/g, "'\\''")}'`;
};

export const buildTmuxAttachCommands = ({
  sessionName,
  paneCount,
  tmuxSocket,
}: {
  sessionName: string;
  paneCount: number;
  tmuxSocket?: string;
}): string[] => {
  const baseArgs = tmuxSocket
    ? ["tmux", "-S", tmuxSocket, "attach-session"]
    : ["tmux", "attach-session"];
  return Array.from({ length: paneCount }, (_, index) => {
    const target = `${sessionName}:${index}`;
    return [...baseArgs, "-t", target].map((part) => escapeShellArg({ value: part })).join(" ");
  });
};

const configurePanes = async ({
  sessionName,
  paneIds,
  specs,
  cliPath,
  nodeArgs,
}: {
  sessionName: string;
  paneIds: string[];
  specs: PaneSpec[];
  cliPath: string;
  nodeArgs: string[];
}): Promise<void> => {
  const tmuxSocket = process.env.CLANKER_TMUX_SOCKET;
  if (tmuxSocket && tmuxSocket.length > 0) {
    await runTmux({
      args: ["set-environment", "-t", sessionName, "CLANKER_TMUX_SOCKET", tmuxSocket],
    });
  }

  for (let i = 0; i < paneIds.length && i < specs.length; i += 1) {
    const paneId = paneIds[i] ?? "";
    const spec = specs[i];
    if (!paneId || !spec) {
      continue;
    }
    const args = spec.usesCodex ? ["--codex-tty", ...spec.args] : spec.args;
    await runTmux({
      args: ["respawn-pane", "-k", "-t", paneId, process.execPath, ...nodeArgs, cliPath, ...args],
    });
    await runTmux({
      args: ["select-pane", "-t", paneId, "-T", `clanker:${spec.title}`],
    });
  }
};

export const runLaunch = async ({
  attach,
  forceTmux,
}: {
  attach?: boolean;
  forceTmux?: boolean;
} = {}): Promise<void> => {
  const repoRoot = process.cwd();
  await runOnboardingIfNeeded({ repoRoot });
  const config = await loadConfig({ repoRoot });
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });

  const state = await loadState({ statePath: paths.statePath });
  state.paused = !config.startImmediately;
  state.pausedRoles = { planner: false, judge: false, slave: false };
  await saveState({ statePath: paths.statePath, state });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: state.paused ? "PAUSED" : "RESUMED",
      msg: state.paused ? "start paused" : "start resumed",
    },
  });

  const sessionName = config.tmuxFilter ?? `clanker-${repoRoot.split("/").pop() ?? "repo"}`;
  const specs = buildPaneSpecs({
    planners: config.planners,
    judges: config.judges,
    slaves: config.slaves,
  });
  const cliPath = await resolveCliPath({ repoRoot });
  const nodeArgs = await resolvePnpArgs({ cliPath });

  const isItermMode = !forceTmux && process.platform === "darwin";
  if (!(await hasSession({ sessionName }))) {
    const paneIds = isItermMode
      ? await createWindowedLayout({
          sessionName,
          cwd: repoRoot,
          specs,
          hideStatus: true,
        })
      : await createLayout({
          sessionName,
          cwd: repoRoot,
          paneCount: specs.length,
        });
    await configurePanes({ sessionName, paneIds, specs, cliPath, nodeArgs });
  } else if (isItermMode) {
    await applySessionOptions({ sessionName, hideStatus: true });
  }

  if (isItermMode) {
    const commands = buildTmuxAttachCommands({
      sessionName,
      paneCount: specs.length,
      tmuxSocket: process.env.CLANKER_TMUX_SOCKET,
    });
    await launchIterm({ cwd: repoRoot, commands });
    console.log("clanker started iTerm2 window");
    return;
  }

  if (attach) {
    await attachSession({ sessionName });
    return;
  }
  console.log(`clanker started tmux session ${sessionName}`);
  console.log(`attach with: tmux attach -t ${sessionName}`);
};
