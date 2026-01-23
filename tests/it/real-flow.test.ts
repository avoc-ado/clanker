import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { jest } from "@jest/globals";
import {
  ensureTmuxInstalled,
  getCliPath,
  isRealMode,
  killTmuxSession,
  makeTmpRepo,
  resolveCodexCommand,
  runCli,
  runTmux,
  setupRealMode,
  waitFor,
  writeConfig,
} from "./utils.js";

const run = isRealMode() ? test : test.skip;
const parseTimeout = ({ fallbackMs }: { fallbackMs: number }): number => {
  const raw = process.env.CLANKER_IT_MAX_MS?.trim();
  if (!raw) {
    return fallbackMs;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
};
const isDebug = process.env.CLANKER_IT_DEBUG === "1";

describe("integration: real flow", () => {
  jest.retryTimes(2, { logErrorsBeforeRetry: true });

  run(
    "planner creates tasks, dashboard assigns, slave produces artifacts",
    async () => {
      const maxMs = parseTimeout({ fallbackMs: 240_000 });
      await ensureTmuxInstalled();
      const repoRoot = resolve(process.cwd());
      const pnpRequire = join(repoRoot, ".pnp.cjs");
      const pnpLoader = join(repoRoot, ".pnp.loader.mjs");
      const root = await makeTmpRepo({
        planLines: [
          'Goal: create artifacts/it-cli.js with the exact contents: console.log("IT_OK");',
          "Use shell commands to write task packets into .clanker/tasks immediately.",
          "Write task packets with ids it-1 and it-2 (one per prompt).",
          "Requirement: planner must output a minimum of 2 task packets.",
          "Ensure at least two tasks (no upper cap). Split into create + verify tasks.",
        ],
      });
      await setupRealMode({ root });
      const artifactPath = join(root, "artifacts", "it-cli.js");
      const debugLogPath = join(root, ".clanker", "it-debug.log");

      await runCli({ cwd: root, args: ["doctor", "--fix"] });
      await writeFile(
        join(root, ".clanker", "state.json"),
        JSON.stringify({ paused: false, tasks: [] }),
        "utf-8",
      );

      const session = `clanker-it-${Date.now()}`;
      const cliPath = getCliPath();
      const { codexCommand } = await resolveCodexCommand({ root });
      const tmuxSocket = process.env.CLANKER_TMUX_SOCKET;
      await writeConfig({
        root,
        codexCommand,
        tmuxFilter: session,
        promptFile: ".clanker/plan-prompt.txt",
      });
      const nodeBase = [process.execPath, "--require", pnpRequire, "--loader", pnpLoader, cliPath];
      if (isDebug) {
        console.log(`it-real debug log: ${debugLogPath}`);
      }
      const readEvents = async (): Promise<string> => {
        try {
          return await readFile(join(root, ".clanker", "events.log"), "utf-8");
        } catch {
          return "";
        }
      };
      const captureWindow = async ({ window }: { window: string }): Promise<string> => {
        try {
          return await runTmux({
            args: ["capture-pane", "-pt", `${session}:${window}`, "-S", "-120"],
          });
        } catch {
          return "";
        }
      };
      const waitForCodexReady = async ({ window }: { window: string }): Promise<void> => {
        await waitFor({
          label: `codex ui ${window}`,
          timeoutMs: Math.min(60_000, Math.floor(maxMs / 3)),
          intervalMs: 1_000,
          check: async () => {
            const output = await captureWindow({ window });
            return output.includes("OpenAI Codex");
          },
        });
      };
      const emitDebug = async ({ label }: { label: string }): Promise<void> => {
        if (!isDebug) {
          return;
        }
        try {
          const [events, panes, plannerPane, slavePane, judgePane] = await Promise.all([
            readEvents(),
            runTmux({
              args: [
                "list-panes",
                "-t",
                session,
                "-F",
                "#{pane_id}\t#{pane_title}\t#{window_name}",
              ],
            }),
            captureWindow({ window: "planner" }),
            captureWindow({ window: "c1" }),
            captureWindow({ window: "judge" }),
          ]);
          const tail = events.split("\n").slice(-10).join("\n").trim();
          const payload = [
            `== it-real ${label} ==`,
            tail.length > 0 ? tail : "(events empty)",
            "--- tmux panes ---",
            panes.trim(),
            "--- planner pane ---",
            plannerPane.trim(),
            "--- slave pane ---",
            slavePane.trim(),
            "--- judge pane ---",
            judgePane.trim(),
          ].join("\n");
          console.log(payload);
          await appendFile(debugLogPath, `${payload}\n`, "utf-8");
        } catch (error) {
          console.log(`it-real debug failed: ${String(error)}`);
        }
      };
      const getPaneIdByTitle = async ({ title }: { title: string }): Promise<string | null> => {
        const raw = await runTmux({
          args: [
            "list-panes",
            "-a",
            "-F",
            "#{session_name}\t#{pane_id}\t#{pane_title}\t#{window_name}",
          ],
        });
        const match = raw
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => {
            const [sessionRaw, paneId, paneTitleRaw, windowNameRaw] = line.split("\t");
            if (sessionRaw !== session) {
              return null;
            }
            const paneTitle = paneTitleRaw?.trim() ?? "";
            const windowName = windowNameRaw?.trim() ?? "";
            return {
              paneId: paneId ?? "",
              title: paneTitle.length > 0 ? paneTitle : windowName,
            };
          })
          .find((pane) => pane?.title === title);
        return match?.paneId ?? null;
      };
      const approvalMatchers = [
        /since this folder is not version controlled/i,
        /since this folder is version controlled/i,
        /allow commands in this folder/i,
        /allow project commands/i,
        /would you like to run the following command/i,
        /press enter to continue/i,
        /press enter to confirm/i,
      ];
      const approvedWindows = new Set<string>();
      const makeApprovalKeys = ({ output }: { output: string }): string[] => {
        if (/since this folder is version controlled/i.test(output)) {
          return ["Up", "Enter"];
        }
        if (/since this folder is not version controlled/i.test(output)) {
          return ["Up", "Enter"];
        }
        if (/since this folder is version controlled/i.test(output)) {
          return ["Enter"];
        }
        if (/would you like to run the following command/i.test(output)) {
          return ["Enter"];
        }
        if (/press enter to continue/i.test(output)) {
          return ["Enter"];
        }
        return ["1", "Enter"];
      };
      const getPaneIdForWindow = async ({ window }: { window: string }): Promise<string | null> => {
        return (
          (await getPaneIdByTitle({ title: `clanker:${window}` })) ??
          (await getPaneIdByTitle({ title: window }))
        );
      };
      const approveCodex = async ({ window }: { window: string }): Promise<void> => {
        try {
          const output = await captureWindow({ window });
          if (!approvalMatchers.some((matcher) => matcher.test(output))) {
            return;
          }
          const isInitialApproval =
            /since this folder is not version controlled/i.test(output) ||
            /since this folder is version controlled/i.test(output);
          if (isInitialApproval && approvedWindows.has(window)) {
            return;
          }
          const keys = makeApprovalKeys({ output });
          const normalizedKeys = keys.map((key) => (key === "Enter" ? "C-m" : key));
          const paneId = await getPaneIdForWindow({ window });
          const target = paneId ?? `${session}:${window}`;
          if (paneId) {
            await runTmux({ args: ["select-pane", "-t", target] });
          }
          await runTmux({
            args: ["send-keys", "-t", target, ...normalizedKeys],
          });
          if (isInitialApproval) {
            approvedWindows.add(window);
          }
        } catch {
          // ignore
        }
      };
      const hasApprovalPrompt = async ({ window }: { window: string }): Promise<boolean> => {
        const output = await captureWindow({ window });
        return approvalMatchers.some((matcher) => matcher.test(output));
      };
      const approveAllCodex = async (): Promise<void> => {
        await Promise.all([
          approveCodex({ window: "planner" }),
          approveCodex({ window: "c1" }),
          approveCodex({ window: "judge" }),
        ]);
      };
      const capturePaneByTitle = async ({
        title,
        fallbackTitle,
      }: {
        title: string;
        fallbackTitle?: string;
      }): Promise<string> => {
        const paneId =
          (await getPaneIdByTitle({ title })) ??
          (fallbackTitle ? await getPaneIdByTitle({ title: fallbackTitle }) : null);
        if (!paneId) {
          return "";
        }
        return runTmux({ args: ["capture-pane", "-pt", paneId, "-S", "-120"] });
      };

      let debugInterval: NodeJS.Timeout | null = null;
      try {
        if (isDebug) {
          debugInterval = setInterval(() => {
            void emitDebug({ label: "tick" });
          }, 15_000);
          debugInterval.unref?.();
        }
        await runTmux({
          args: ["new-session", "-d", "-s", session, "-n", "dashboard", "-c", root],
        });
        if (tmuxSocket) {
          await runTmux({
            args: ["set-environment", "-t", session, "CLANKER_TMUX_SOCKET", tmuxSocket],
          });
        }
        await runTmux({ args: ["set-window-option", "-g", "allow-rename", "off"] });
        await runTmux({ args: ["set-window-option", "-g", "automatic-rename", "off"] });
        await runTmux({ args: ["set-option", "-g", "set-titles", "off"] });
        await runTmux({ args: ["set-environment", "-t", session, "CLANKER_CODEX_TTY", "1"] });
        await runTmux({
          args: ["set-environment", "-t", session, "CLANKER_PROMPT_MODE", "file"],
        });
        await runTmux({ args: ["set-window-option", "-g", "remain-on-exit", "on"] });
        await runTmux({
          args: ["select-pane", "-t", `${session}:dashboard`, "-T", "clanker:dashboard"],
        });
        await runTmux({
          args: ["new-window", "-t", session, "-n", "planner", "-c", root],
        });
        await runTmux({
          args: ["select-pane", "-t", `${session}:planner`, "-T", "clanker:planner"],
        });
        await runTmux({
          args: ["new-window", "-t", session, "-n", "c1", "-c", root],
        });
        await runTmux({
          args: ["select-pane", "-t", `${session}:c1`, "-T", "clanker:c1"],
        });
        await runTmux({
          args: ["new-window", "-t", session, "-n", "judge", "-c", root],
        });
        await runTmux({
          args: ["select-pane", "-t", `${session}:judge`, "-T", "clanker:judge"],
        });

        await waitFor({
          label: "tmux panes",
          timeoutMs: Math.min(30_000, Math.floor(maxMs / 4)),
          intervalMs: 1_000,
          check: async () => {
            const windows = await runTmux({
              args: ["list-windows", "-t", session, "-F", "#{window_name}"],
            });
            const windowNames = windows
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            return ["dashboard", "planner", "c1", "judge"].every((name) =>
              windowNames.includes(name),
            );
          },
        });

        await emitDebug({ label: "panes-ready" });

        await runTmux({
          args: ["respawn-pane", "-k", "-t", `${session}:dashboard`, ...nodeBase, "dashboard"],
        });
        await runTmux({
          args: [
            "respawn-pane",
            "-k",
            "-t",
            `${session}:planner`,
            ...nodeBase,
            "--codex-tty",
            "planner",
          ],
        });
        await runTmux({
          args: [
            "respawn-pane",
            "-k",
            "-t",
            `${session}:c1`,
            ...nodeBase,
            "--codex-tty",
            "slave",
            "1",
          ],
        });
        await runTmux({
          args: [
            "respawn-pane",
            "-k",
            "-t",
            `${session}:judge`,
            ...nodeBase,
            "--codex-tty",
            "judge",
          ],
        });

        await emitDebug({ label: "processes-started" });
        await approveAllCodex();
        await waitFor({
          label: "codex approvals",
          timeoutMs: Math.min(30_000, Math.floor(maxMs / 4)),
          intervalMs: 1_000,
          check: async () => {
            await approveAllCodex();
            const approvals = await Promise.all([
              hasApprovalPrompt({ window: "planner" }),
              hasApprovalPrompt({ window: "c1" }),
              hasApprovalPrompt({ window: "judge" }),
            ]);
            return approvals.every((pending) => !pending);
          },
        });

        await waitFor({
          label: "codex logs",
          timeoutMs: Math.min(60_000, Math.floor(maxMs / 3)),
          intervalMs: 1_000,
          check: async () => {
            await approveAllCodex();
            const raw = await readEvents();
            return raw.includes('"CHAT_LOG"') && raw.includes('"planner"');
          },
        });

        try {
          await waitFor({
            label: "planner/slave/judge ready",
            timeoutMs: Math.min(60_000, Math.floor(maxMs / 3)),
            intervalMs: 1_000,
            check: async () => {
              await approveAllCodex();
              const raw = await readEvents();
              return (
                raw.includes('"PLANNER_READY"') &&
                raw.includes('"SLAVE_READY"') &&
                raw.includes('"JUDGE_READY"')
              );
            },
          });
        } catch (error) {
          const [plannerOutput, slaveOutput, judgeOutput, events] = await Promise.all([
            capturePaneByTitle({ title: "clanker:planner", fallbackTitle: "planner" }),
            capturePaneByTitle({ title: "clanker:c1", fallbackTitle: "c1" }),
            capturePaneByTitle({ title: "clanker:judge", fallbackTitle: "judge" }),
            readEvents(),
          ]);
          const windows = await runTmux({
            args: ["list-windows", "-t", session, "-F", "#{window_name}"],
          });
          throw new Error(
            [
              String(error),
              "--- events.log ---",
              events.trim(),
              "--- planner pane ---",
              plannerOutput.trim(),
              "--- slave pane ---",
              slaveOutput.trim(),
              "--- judge pane ---",
              judgeOutput.trim(),
              "--- tmux windows ---",
              windows.trim(),
            ].join("\n"),
          );
        }

        await Promise.all([
          waitForCodexReady({ window: "planner" }),
          waitForCodexReady({ window: "c1" }),
          waitForCodexReady({ window: "judge" }),
        ]);

        await emitDebug({ label: "plan-auto" });

        try {
          await waitFor({
            label: "task packets",
            timeoutMs: Math.min(180_000, Math.floor(maxMs / 2)),
            intervalMs: 2_000,
            check: async () => {
              await approveAllCodex();
              const files = await readdir(join(root, ".clanker", "tasks"));
              return files.filter((file) => file.endsWith(".json")).length >= 2;
            },
          });
        } catch (error) {
          const plannerOutput = await capturePaneByTitle({
            title: "clanker:planner",
            fallbackTitle: "planner",
          });
          const windows = await runTmux({
            args: ["list-windows", "-t", session, "-F", "#{window_name}"],
          });
          throw new Error(
            [
              String(error),
              "--- planner pane ---",
              plannerOutput.trim(),
              "--- tmux windows ---",
              windows.trim(),
            ].join("\n"),
          );
        }

        await waitFor({
          label: "task prompted",
          timeoutMs: Math.min(180_000, Math.floor(maxMs / 2)),
          intervalMs: 2_000,
          check: async () => {
            await approveAllCodex();
            const raw = await readEvents();
            return raw.includes('"TASK_PROMPTED"');
          },
        });

        await waitFor({
          label: "artifact output",
          timeoutMs: Math.min(240_000, Math.floor(maxMs / 2)),
          intervalMs: 2_000,
          check: async () => {
            await approveAllCodex();
            try {
              const raw = await readFile(artifactPath, "utf-8");
              return raw.includes("IT_OK");
            } catch {
              return false;
            }
          },
        });
      } finally {
        if (debugInterval) {
          clearInterval(debugInterval);
        }
        await emitDebug({ label: "cleanup" });
        await killTmuxSession({ session });
      }
    },
    parseTimeout({ fallbackMs: 300_000 }),
  );
});
