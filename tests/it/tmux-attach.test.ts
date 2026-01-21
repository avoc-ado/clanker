import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";
import { listPanes, sendKeys } from "../../src/tmux.js";
import { ensureTmuxInstalled, runTmux, waitFor } from "./utils.js";

describe("integration: tmux attach", () => {
  jest.retryTimes(2, { logErrorsBeforeRetry: true });

  test("discovers panes and sends keys", async () => {
    await ensureTmuxInstalled();

    const root = await mkdtemp(join(tmpdir(), "clanker-it-"));
    const session = `clanker-it-${Date.now()}`;
    const outputPath = join(root, "tmux-output.txt");
    try {
      await runTmux({
        args: ["new-session", "-d", "-s", session, "-n", "dashboard", "-c", root],
      });
      await waitFor({
        label: "tmux session",
        timeoutMs: 3_000,
        intervalMs: 100,
        check: async () => {
          try {
            const output = await runTmux({ args: ["list-sessions"] });
            return output.includes(session);
          } catch {
            return false;
          }
        },
      });
      await runTmux({
        args: ["select-pane", "-t", `${session}:dashboard`, "-T", "clanker:dashboard"],
      });

      const panes = await listPanes({ sessionName: session });
      const dashboardPane = panes.find((pane) => pane.title === "clanker:dashboard");
      if (!dashboardPane) {
        throw new Error("dashboard pane not found");
      }

      await sendKeys({
        paneId: dashboardPane.paneId,
        text: `printf "TMUX_OK" > "${outputPath}"`,
      });

      await waitFor({
        label: "tmux output",
        timeoutMs: 2_000,
        intervalMs: 100,
        check: async () => {
          try {
            const content = await readFile(outputPath, "utf-8");
            return content === "TMUX_OK";
          } catch {
            return false;
          }
        },
      });
    } finally {
      try {
        await runTmux({ args: ["kill-session", "-t", session] });
      } catch {
        // ignore
      }
    }
  });
});
