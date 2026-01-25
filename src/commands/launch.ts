import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import { getRepoRoot } from "../repo-root.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadState, saveState } from "../state/state.js";
import { appendEvent } from "../state/events.js";
import { runTmux } from "../tmux.js";
import { runOnboardingIfNeeded } from "./onboarding.js";
import { launchIterm } from "../iterm.js";
import { ensureRoleWorktrees } from "../worktrees.js";

interface PaneSpec {
  title: string;
  args: string[];
  usesCodex: boolean;
  cwd: string;
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

const escapeHookCommand = ({ value }: { value: string }): string => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const configureDetachHooks = async ({ sessionName }: { sessionName: string }): Promise<void> => {
  const sessionTarget = `${sessionName}:`;
  const sessionCheck = [
    'if -F "#{==:#{session_name},' + sessionName + '}"',
    "{",
    `run-shell "tmux list-clients -t ${sessionTarget} 2>/dev/null | wc -l | grep -q '^0$' && tmux kill-session -t ${sessionTarget}"`,
    "}",
  ].join(" ");
  const windowCheck = [
    'if -F "#{==:#{session_name},' + sessionName + '}"',
    "{",
    `run-shell "tmux list-clients -t ${sessionTarget} -F '#{client_window}' 2>/dev/null | grep -q '^#{window_id}$' || tmux kill-window -t #{window_id}"`,
    "}",
  ].join(" ");
  await runTmux({
    args: [
      "set-hook",
      "-t",
      sessionName,
      "client-detached",
      escapeHookCommand({ value: sessionCheck }),
    ],
  });
  await runTmux({
    args: [
      "set-hook",
      "-t",
      sessionName,
      "client-detached",
      escapeHookCommand({ value: windowCheck }),
      "-a",
    ],
  });
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
  windowName,
}: {
  sessionName: string;
  windowName: string;
}): Promise<string | null> => {
  try {
    const output = await runTmux({
      args: ["list-panes", "-t", `${sessionName}:${windowName}`, "-F", "#{pane_id}"],
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

const ensureWindowedLayout = async ({
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
  const paneIds: string[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const title = specs[i]?.title ?? `clanker-${i + 1}`;
    let paneId = await listWindowPaneId({ sessionName, windowName: title });
    if (!paneId) {
      await runTmux({ args: ["new-window", "-t", sessionName, "-n", title, "-c", cwd] });
      paneId = await listWindowPaneId({ sessionName, windowName: title });
    }
    if (paneId) {
      paneIds.push(paneId);
    }
  }
  return paneIds;
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
  return ensureWindowedLayout({ sessionName, cwd, specs, hideStatus });
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
  repoRoot,
  worktrees,
}: {
  planners: number;
  judges: number;
  slaves: number;
  repoRoot: string;
  worktrees: {
    planner: string[];
    judge: string[];
    slave: string[];
  };
}): PaneSpec[] => {
  const specs: PaneSpec[] = [
    { title: "dashboard", args: ["dashboard"], usesCodex: false, cwd: repoRoot },
  ];
  for (let i = 1; i <= planners; i += 1) {
    const args = i === 1 ? ["planner"] : ["planner", `${i}`];
    const cwd = worktrees.planner[i - 1] ?? repoRoot;
    specs.push({ title: `planner-${i}`, args, usesCodex: true, cwd });
  }
  for (let i = 1; i <= judges; i += 1) {
    const args = i === 1 ? ["judge"] : ["judge", `${i}`];
    const cwd = worktrees.judge[i - 1] ?? repoRoot;
    specs.push({ title: `judge-${i}`, args, usesCodex: true, cwd });
  }
  for (let i = 1; i <= slaves; i += 1) {
    const cwd = worktrees.slave[i - 1] ?? repoRoot;
    specs.push({ title: `c${i}`, args: ["slave", `${i}`], usesCodex: true, cwd });
  }
  return specs;
};

const escapeShellArg = ({ value }: { value: string }): string => {
  return `'${value.replace(/'/g, "'\\''")}'`;
};

export const buildTmuxAttachCommands = ({
  sessionName,
  windowNames,
  tmuxSocket,
}: {
  sessionName: string;
  windowNames: string[];
  tmuxSocket?: string;
}): string[] => {
  const baseArgs = tmuxSocket
    ? ["tmux", "-S", tmuxSocket, "attach-session"]
    : ["tmux", "attach-session"];
  return windowNames.map((name) => {
    const target = `${sessionName}:${name}`;
    return [...baseArgs, "-t", target].map((part) => escapeShellArg({ value: part })).join(" ");
  });
};

const configurePanes = async ({
  sessionName,
  paneIds,
  specs,
  cliPath,
  nodeArgs,
  repoRoot,
}: {
  sessionName: string;
  paneIds: string[];
  specs: PaneSpec[];
  cliPath: string;
  nodeArgs: string[];
  repoRoot: string;
}): Promise<void> => {
  const tmuxSocket = process.env.CLANKER_TMUX_SOCKET;
  if (tmuxSocket && tmuxSocket.length > 0) {
    await runTmux({
      args: ["set-environment", "-t", sessionName, "CLANKER_TMUX_SOCKET", tmuxSocket],
    });
  }
  await runTmux({
    args: ["set-environment", "-t", sessionName, "CLANKER_REPO_ROOT", repoRoot],
  });

  for (let i = 0; i < paneIds.length && i < specs.length; i += 1) {
    const paneId = paneIds[i] ?? "";
    const spec = specs[i];
    if (!paneId || !spec) {
      continue;
    }
    const args = spec.usesCodex ? ["--codex-tty", ...spec.args] : spec.args;
    await runTmux({
      args: [
        "respawn-pane",
        "-k",
        "-c",
        spec.cwd,
        "-t",
        paneId,
        process.execPath,
        ...nodeArgs,
        cliPath,
        ...args,
      ],
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
  const repoRoot = getRepoRoot();
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
  const worktreeSpecs = await ensureRoleWorktrees({
    repoRoot,
    planners: config.planners,
    judges: config.judges,
    slaves: config.slaves,
    ref: "origin/main",
  });
  const worktreePaths = worktreeSpecs.reduce(
    (acc, spec) => {
      acc[spec.role].push(spec.path);
      return acc;
    },
    { planner: [] as string[], judge: [] as string[], slave: [] as string[] },
  );
  const specs = buildPaneSpecs({
    planners: config.planners,
    judges: config.judges,
    slaves: config.slaves,
    repoRoot,
    worktrees: worktreePaths,
  });
  const cliPath = await resolveCliPath({ repoRoot });
  const nodeArgs = await resolvePnpArgs({ cliPath });

  const isItermMode = !forceTmux && process.platform === "darwin";
  const sessionExists = await hasSession({ sessionName });
  if (!sessionExists) {
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
    await configurePanes({ sessionName, paneIds, specs, cliPath, nodeArgs, repoRoot });
    await configureDetachHooks({ sessionName });
  } else if (isItermMode) {
    await applySessionOptions({ sessionName, hideStatus: true });
    const paneIds = await ensureWindowedLayout({
      sessionName,
      cwd: repoRoot,
      specs,
      hideStatus: true,
    });
    await configurePanes({ sessionName, paneIds, specs, cliPath, nodeArgs, repoRoot });
    await configureDetachHooks({ sessionName });
  }

  if (isItermMode) {
    const commands = buildTmuxAttachCommands({
      sessionName,
      windowNames: specs.map((spec) => spec.title),
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
