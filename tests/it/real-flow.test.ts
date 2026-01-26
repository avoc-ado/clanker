import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { jest } from "@jest/globals";
import { getWorktreePath } from "../../src/worktrees.js";
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
          "Use `clanker task add` to create task packets immediately.",
          "Write task packets with ids it-1 and it-2 (one per prompt).",
          "Requirement: planner must output a minimum of 2 task packets.",
          "Ensure at least two tasks (no upper cap). Split into create + verify tasks.",
        ],
      });
      await setupRealMode({ root });
      const artifactPath = join(root, "artifacts", "it-cli.js");
      const worktreeArtifactPath = join(
        getWorktreePath({ repoRoot: root, role: "slave", index: 1 }),
        "artifacts",
        "it-cli.js",
      );
      const debugLogPath = join(root, ".clanker", "it-debug.log");
      const logToStdout = process.env.CLANKER_IT_DEBUG === "1";

      await runCli({ cwd: root, args: ["doctor", "--fix"] });
      await writeFile(
        join(root, ".clanker", "state.json"),
        JSON.stringify({ paused: false, tasks: [] }),
        "utf-8",
      );

      const session = `clanker-it-${Date.now()}`;
      const ipcSocket = join(root, ".clanker", "ipc.sock");
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
      await mkdir(dirname(debugLogPath), { recursive: true });
      await writeFile(debugLogPath, `== it-real start ${new Date().toISOString()} ==\n`, "utf-8");
      const appendDebug = async ({ payload }: { payload: string }): Promise<void> => {
        await appendFile(debugLogPath, `${payload}\n`, "utf-8");
        if (logToStdout) {
          console.log(payload);
        }
      };
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
      const tailText = ({
        text,
        maxLines,
        maxChars,
      }: {
        text: string;
        maxLines: number;
        maxChars: number;
      }): string => {
        const trimmed = text.slice(-maxChars);
        const lines = trimmed.split("\n");
        return lines.slice(-maxLines).join("\n");
      };
      const safe = async <T>({
        label,
        run,
      }: {
        label: string;
        run: () => Promise<T>;
      }): Promise<{ label: string; value?: T; error?: string }> => {
        try {
          const value = await run();
          return { label, value };
        } catch (error) {
          return { label, error: String(error) };
        }
      };
      const emitDebug = async ({ label }: { label: string }): Promise<void> => {
        const snapshotTs = new Date().toISOString();
        const [
          eventsResult,
          stateResult,
          tasksResult,
          historyResult,
          logsResult,
          artifactsResult,
          promptResult,
          panesResult,
          windowsResult,
          sessionsResult,
        ] = await Promise.all([
          safe({ label: "events", run: readEvents }),
          safe({
            label: "state",
            run: async () => readFile(join(root, ".clanker", "state.json"), "utf-8"),
          }),
          safe({
            label: "tasks",
            run: async () => readdir(join(root, ".clanker", "tasks")),
          }),
          safe({
            label: "history",
            run: async () => readdir(join(root, ".clanker", "history")),
          }),
          safe({
            label: "logs",
            run: async () => readdir(join(root, ".clanker", "logs")),
          }),
          safe({
            label: "artifacts",
            run: async () => readdir(join(root, "artifacts")),
          }),
          safe({
            label: "plan-prompt",
            run: async () => readFile(join(root, ".clanker", "plan-prompt.txt"), "utf-8"),
          }),
          safe({
            label: "panes",
            run: async () =>
              runTmux({
                args: [
                  "list-panes",
                  "-t",
                  session,
                  "-F",
                  "#{pane_id}\t#{pane_title}\t#{window_name}",
                ],
              }),
          }),
          safe({
            label: "windows",
            run: async () =>
              runTmux({
                args: [
                  "list-windows",
                  "-t",
                  session,
                  "-F",
                  "#{window_name}\t#{window_id}\t#{window_active}",
                ],
              }),
          }),
          safe({
            label: "sessions",
            run: async () =>
              runTmux({ args: ["list-sessions", "-F", "#{session_name}\t#{session_windows}"] }),
          }),
        ]);

        const windowNames =
          windowsResult.value
            ?.split("\n")
            .map((line) => line.trim().split("\t")[0] ?? "")
            .filter((name) => name.length > 0) ?? [];

        const windowCaptures = await Promise.all(
          windowNames.map((window) =>
            safe({
              label: `capture:${window}`,
              run: async () => captureWindow({ window }),
            }),
          ),
        );

        const logTails = await Promise.all(
          (logsResult.value ?? []).map((name) =>
            safe({
              label: `log:${name}`,
              run: async () => readFile(join(root, ".clanker", "logs", name), "utf-8"),
            }),
          ),
        );

        const payload = [
          `== it-real ${label} @ ${snapshotTs} ==`,
          "--- session ---",
          session,
          "--- codex command ---",
          codexCommand,
          "--- tmux sessions ---",
          sessionsResult.error
            ? `error: ${sessionsResult.error}`
            : (sessionsResult.value ?? "").trim(),
          "--- tmux windows ---",
          windowsResult.error
            ? `error: ${windowsResult.error}`
            : (windowsResult.value ?? "").trim(),
          "--- tmux panes ---",
          panesResult.error ? `error: ${panesResult.error}` : (panesResult.value ?? "").trim(),
          "--- events ---",
          eventsResult.error
            ? `error: ${eventsResult.error}`
            : tailText({ text: eventsResult.value ?? "", maxLines: 50, maxChars: 8000 }).trim() ||
              "(events empty)",
          "--- state ---",
          stateResult.error ? `error: ${stateResult.error}` : (stateResult.value ?? "").trim(),
          "--- tasks ---",
          tasksResult.error ? `error: ${tasksResult.error}` : (tasksResult.value ?? []).join("\n"),
          "--- history ---",
          historyResult.error
            ? `error: ${historyResult.error}`
            : (historyResult.value ?? []).join("\n"),
          "--- artifacts ---",
          artifactsResult.error
            ? `error: ${artifactsResult.error}`
            : (artifactsResult.value ?? []).join("\n"),
          "--- plan prompt ---",
          promptResult.error
            ? `error: ${promptResult.error}`
            : tailText({ text: promptResult.value ?? "", maxLines: 80, maxChars: 8000 }).trim(),
          "--- windows capture ---",
          ...windowCaptures.flatMap((entry) => [
            `-- ${entry.label} --`,
            entry.error
              ? `error: ${entry.error}`
              : tailText({ text: entry.value ?? "", maxLines: 80, maxChars: 8000 }).trim(),
          ]),
          "--- logs ---",
          ...logTails.flatMap((entry) => [
            `-- ${entry.label} --`,
            entry.error
              ? `error: ${entry.error}`
              : tailText({ text: entry.value ?? "", maxLines: 80, maxChars: 8000 }).trim(),
          ]),
        ].join("\n");
        await appendDebug({ payload });
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
          approveCodex({ window: "planner-1" }),
          approveCodex({ window: "slave-1" }),
          approveCodex({ window: "judge-1" }),
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
        debugInterval = setInterval(() => {
          void emitDebug({ label: "tick" });
        }, 15_000);
        debugInterval.unref?.();
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
          args: ["set-environment", "-t", session, "CLANKER_IPC_SOCKET", ipcSocket],
        });
        await runTmux({
          args: ["set-environment", "-t", session, "CLANKER_PROMPT_MODE", "file"],
        });
        await runTmux({ args: ["set-window-option", "-g", "remain-on-exit", "on"] });
        await runTmux({
          args: ["select-pane", "-t", `${session}:dashboard`, "-T", "clanker:dashboard"],
        });
        await runTmux({
          args: ["new-window", "-t", session, "-n", "planner-1", "-c", root],
        });
        await runTmux({
          args: ["select-pane", "-t", `${session}:planner-1`, "-T", "clanker:planner-1"],
        });
        await runTmux({
          args: ["new-window", "-t", session, "-n", "slave-1", "-c", root],
        });
        await runTmux({
          args: ["select-pane", "-t", `${session}:slave-1`, "-T", "clanker:slave-1"],
        });
        await runTmux({
          args: ["new-window", "-t", session, "-n", "judge-1", "-c", root],
        });
        await runTmux({
          args: ["select-pane", "-t", `${session}:judge-1`, "-T", "clanker:judge-1"],
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
            return ["dashboard", "planner-1", "slave-1", "judge-1"].every((name) =>
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
            `${session}:planner-1`,
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
            `${session}:slave-1`,
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
            `${session}:judge-1`,
            ...nodeBase,
            "--codex-tty",
            "judge",
          ],
        });

        await emitDebug({ label: "processes-started" });
        await approveAllCodex();
        try {
          await waitFor({
            label: "codex approvals",
            timeoutMs: Math.min(30_000, Math.floor(maxMs / 4)),
            intervalMs: 1_000,
            check: async () => {
              await approveAllCodex();
              const approvals = await Promise.all([
                hasApprovalPrompt({ window: "planner-1" }),
                hasApprovalPrompt({ window: "slave-1" }),
                hasApprovalPrompt({ window: "judge-1" }),
              ]);
              return approvals.every((pending) => !pending);
            },
          });
        } catch (error) {
          await emitDebug({ label: "approval-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }

        try {
          await waitFor({
            label: "codex logs",
            timeoutMs: Math.min(60_000, Math.floor(maxMs / 3)),
            intervalMs: 1_000,
            check: async () => {
              await approveAllCodex();
              const raw = await readEvents();
              return raw.includes('"CHAT_LOG"') && raw.includes('"planner-1"');
            },
          });
        } catch (error) {
          await emitDebug({ label: "codex-logs-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }

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
          await emitDebug({ label: "ready-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }

        try {
          await Promise.all([
            waitForCodexReady({ window: "planner-1" }),
            waitForCodexReady({ window: "slave-1" }),
            waitForCodexReady({ window: "judge-1" }),
          ]);
        } catch (error) {
          await emitDebug({ label: "codex-ready-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }

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
          await emitDebug({ label: "task-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }

        try {
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
        } catch (error) {
          await emitDebug({ label: "task-prompt-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }

        try {
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
                try {
                  const raw = await readFile(worktreeArtifactPath, "utf-8");
                  return raw.includes("IT_OK");
                } catch {
                  return false;
                }
              }
            },
          });
        } catch (error) {
          await emitDebug({ label: "artifact-timeout" });
          throw new Error(`${String(error)}\nSee ${debugLogPath} for full diagnostics.`);
        }
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
