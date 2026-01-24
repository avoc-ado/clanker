import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
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
  await runTmux({ args: ["set-window-option", "-t", sessionName, "allow-rename", "off"] });
  await runTmux({ args: ["set-window-option", "-t", sessionName, "automatic-rename", "off"] });
  await runTmux({ args: ["set-option", "-t", sessionName, "set-titles", "off"] });
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

const buildItermCommands = ({
  cliPath,
  specs,
}: {
  cliPath: string;
  specs: PaneSpec[];
}): string[] => {
  return specs.map((spec) => {
    const args = spec.usesCodex ? ["--codex-tty", ...spec.args] : spec.args;
    const parts = [process.execPath, cliPath, ...args].map((part) =>
      escapeShellArg({ value: part }),
    );
    return parts.join(" ");
  });
};

const configurePanes = async ({
  sessionName,
  paneIds,
  specs,
  cliPath,
}: {
  sessionName: string;
  paneIds: string[];
  specs: PaneSpec[];
  cliPath: string;
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
      args: ["respawn-pane", "-k", "-t", paneId, process.execPath, cliPath, ...args],
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

  if (!forceTmux && process.platform === "darwin") {
    try {
      const commands = buildItermCommands({ cliPath, specs });
      await launchIterm({ cwd: repoRoot, commands });
      console.log("clanker started iTerm2 window");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`iTerm2 launch failed; falling back to tmux (${message})`);
    }
  }

  if (!(await hasSession({ sessionName }))) {
    const paneIds = await createLayout({
      sessionName,
      cwd: repoRoot,
      paneCount: specs.length,
    });
    await configurePanes({ sessionName, paneIds, specs, cliPath });
  }

  if (attach) {
    await attachSession({ sessionName });
    return;
  }
  console.log(`clanker started tmux session ${sessionName}`);
  console.log(`attach with: tmux attach -t ${sessionName}`);
};
