import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface TmuxPane {
  paneId: string;
  title: string;
}

const execFileAsync = promisify(execFile);

export const runTmux = async ({ args }: { args: string[] }): Promise<string> => {
  const socket = process.env.CLANKER_TMUX_SOCKET?.trim();
  const baseArgs = socket ? ["-S", socket, ...args] : args;
  const { stdout } = await execFileAsync("tmux", baseArgs);
  return stdout.trim();
};

export const listPanes = async ({
  sessionName,
  sessionPrefix,
}: {
  sessionName?: string;
  sessionPrefix?: string;
} = {}): Promise<TmuxPane[]> => {
  try {
    const targetArgs = ["list-panes", "-a"];
    const output = await runTmux({
      args: [...targetArgs, "-F", "#{session_name}\t#{pane_id}\t#{pane_title}\t#{window_name}"],
    });
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [sessionRaw, paneId, paneTitleRaw, windowNameRaw] = line.split("\t");
        const matchesSession = sessionName ? sessionRaw === sessionName : true;
        const matchesPrefix = sessionPrefix
          ? sessionRaw === sessionPrefix || sessionRaw.startsWith(`${sessionPrefix}-`)
          : true;
        if (!matchesSession || !matchesPrefix) {
          return null;
        }
        const paneTitle = paneTitleRaw?.trim() ?? "";
        const windowName = windowNameRaw?.trim() ?? "";
        const resolvedTitle = paneTitle.startsWith("clanker:")
          ? paneTitle
          : windowName.length > 0
            ? windowName
            : paneTitle;
        return {
          paneId: paneId ?? "",
          title: resolvedTitle,
        } satisfies TmuxPane;
      })
      .filter((pane): pane is TmuxPane => Boolean(pane && pane.paneId.length > 0));
  } catch {
    return [];
  }
};

export const capturePane = async ({
  paneId,
  lines,
}: {
  paneId: string;
  lines: number;
}): Promise<string> => {
  try {
    const output = await runTmux({
      args: ["capture-pane", "-pt", paneId, "-S", `-${lines}`],
    });
    return output;
  } catch {
    return "";
  }
};

export const selectPane = async ({ paneId }: { paneId: string }): Promise<void> => {
  try {
    await runTmux({ args: ["select-pane", "-t", paneId] });
  } catch {
    // ignore
  }
};

export const getCurrentPaneId = async (): Promise<string | null> => {
  try {
    const output = await runTmux({ args: ["display-message", "-p", "#{pane_id}"] });
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
};

export const sendKeys = async ({
  paneId,
  text,
  submitWithTab,
}: {
  paneId: string;
  text: string;
  submitWithTab?: boolean;
}): Promise<void> => {
  try {
    if (text.includes("\n")) {
      await runTmux({ args: ["set-buffer", "--", text] });
      await runTmux({ args: ["paste-buffer", "-t", paneId, "-d"] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (submitWithTab) {
        await runTmux({ args: ["send-keys", "-t", paneId, "Tab"] });
      }
      await runTmux({ args: ["send-keys", "-t", paneId, "C-m"] });
      return;
    }
    await runTmux({ args: ["send-keys", "-t", paneId, "-l", "--", text] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (submitWithTab) {
      await runTmux({ args: ["send-keys", "-t", paneId, "Tab"] });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await runTmux({ args: ["send-keys", "-t", paneId, "C-m"] });
  } catch {
    // ignore
  }
};

export const sendKey = async ({ paneId, key }: { paneId: string; key: string }): Promise<void> => {
  try {
    await runTmux({ args: ["send-keys", "-t", paneId, key] });
  } catch {
    // ignore
  }
};
