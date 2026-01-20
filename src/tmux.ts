import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface TmuxPane {
  paneId: string;
  title: string;
}

const execFileAsync = promisify(execFile);

const runTmux = async ({ args }: { args: string[] }): Promise<string> => {
  const { stdout } = await execFileAsync("tmux", args);
  return stdout.trim();
};

export const listPanes = async ({ sessionName }: { sessionName?: string } = {}): Promise<
  TmuxPane[]
> => {
  try {
    const targetArgs = sessionName ? ["list-panes", "-t", sessionName] : ["list-panes", "-a"];
    const output = await runTmux({
      args: [...targetArgs, "-F", "#{pane_id} #{pane_title}"],
    });
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [paneId, ...titleParts] = line.split(" ");
        return {
          paneId: paneId ?? "",
          title: titleParts.join(" ").trim(),
        } satisfies TmuxPane;
      })
      .filter((pane) => pane.paneId.length > 0);
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
}: {
  paneId: string;
  text: string;
}): Promise<void> => {
  try {
    await runTmux({ args: ["send-keys", "-t", paneId, text, "Enter"] });
  } catch {
    // ignore
  }
};
