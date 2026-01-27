import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import type { TaskStatus } from "../state/tasks.js";
import { saveTask, loadTask } from "../state/tasks.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { writeHistory } from "../state/history.js";
import { buildHandoffContent, buildNoteContent } from "../state/task-content.js";
import { applyTaskUsage, type TaskUsageInput } from "../state/task-usage.js";
import { ensureSlaveCommitForTask } from "../state/task-commits.js";
import { TASK_SCHEMA } from "../plan/schema.js";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import type { Argv, ArgumentsCamelCase } from "yargs";
import { getRepoRoot } from "../repo-root.js";
import { sendIpcRequest } from "../ipc/client.js";

const requireValue = ({ value, label }: { value: string | undefined; label: string }): string => {
  if (!value || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const parseOptionalNumber = ({ value }: { value: unknown }): number | undefined => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const withUsageOptions = ({ parser }: { parser: Argv }): Argv => {
  return parser
    .option("tok", { type: "number" })
    .option("cost", { type: "number" })
    .option("judge-tok", { type: "number" })
    .option("judge-cost", { type: "number" });
};

const getUsageFromArgs = ({
  argv,
}: {
  argv: {
    tok?: number;
    cost?: number;
    judgeTok?: number;
    judgeCost?: number;
  };
}): TaskUsageInput => {
  return {
    tokens: parseOptionalNumber({ value: argv.tok }),
    cost: parseOptionalNumber({ value: argv.cost }),
    judgeTokens: parseOptionalNumber({ value: argv.judgeTok }),
    judgeCost: parseOptionalNumber({ value: argv.judgeCost }),
  };
};

const tryIpc = async ({ type, payload }: { type: string; payload: unknown }): Promise<boolean> => {
  const socketPath = process.env.CLANKER_IPC_SOCKET?.trim();
  if (!socketPath) {
    return false;
  }
  try {
    const response = await sendIpcRequest({ socketPath, type, payload });
    if (!response.ok) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const runTask = async ({ args }: { args: string[] }): Promise<void> => {
  const repoRoot = getRepoRoot();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const parser = yargs(args)
    .scriptName("clanker task")
    .help(false)
    .strict()
    .exitProcess(false)
    .fail((message: string, error?: Error) => {
      throw error ?? new Error(message);
    })
    .command(
      "add <id> [prompt..]",
      "queue a task",
      (y: Argv) =>
        y
          .positional("id", { type: "string" })
          .positional("prompt", { type: "string", array: true })
          .option("json", { type: "string" }),
      async (
        argv: ArgumentsCamelCase<{
          id: string;
          prompt?: (string | number)[];
          json?: string;
        }>,
      ) => {
        const id = requireValue({ value: argv.id as string | undefined, label: "task id" });
        const prompt = (argv.prompt ?? []).map(String).join(" ").trim();
        const jsonRaw = argv.json?.trim() ?? "";
        const task = (() => {
          if (jsonRaw.length > 0) {
            const parsed = JSON.parse(jsonRaw) as Record<string, unknown>;
            return {
              ...parsed,
              id: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : id,
              status: typeof parsed.status === "string" ? parsed.status : "queued",
              prompt: typeof parsed.prompt === "string" ? parsed.prompt : prompt,
            };
          }
          if (!prompt) {
            throw new Error("Missing prompt text");
          }
          return { id, status: "queued", prompt };
        })();
        const handled = await tryIpc({ type: "task_create", payload: { task } });
        if (!handled) {
          await saveTask({
            tasksDir: paths.tasksDir,
            task: task as Parameters<typeof saveTask>[0]["task"],
          });
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "TASK_CREATED",
              msg: "task created",
              taskId: id,
            },
          });
        }
        console.log(`task ${id} queued`);
      },
    )
    .command(
      "status <id> <status>",
      "set task status",
      (y: Argv) => y.positional("id", { type: "string" }).positional("status", { type: "string" }),
      async (argv: ArgumentsCamelCase<{ id: string; status: string }>) => {
        const id = requireValue({ value: argv.id as string | undefined, label: "task id" });
        const nextStatus = requireValue({
          value: argv.status as string | undefined,
          label: "status",
        });
        if (!TASK_SCHEMA.status.includes(nextStatus)) {
          throw new Error(`Invalid status: ${nextStatus}`);
        }
        const status = nextStatus as TaskStatus;
        const existingTask = await loadTask({ tasksDir: paths.tasksDir, id });
        if (!existingTask) {
          throw new Error(`Task not found: ${id}`);
        }
        if (status === "needs_judge") {
          const config = await loadConfig({ repoRoot });
          const commitResult = await ensureSlaveCommitForTask({
            repoRoot,
            paths,
            config,
            task: existingTask,
          });
          if (commitResult.status === "commit_failed") {
            throw new Error(
              `Slave commit required before needs_judge (${commitResult.message ?? "commit failed"})`,
            );
          }
        }
        const handled = await tryIpc({
          type: "task_status",
          payload: { taskId: id, status },
        });
        if (!handled) {
          const task = await loadTask({ tasksDir: paths.tasksDir, id });
          if (!task) {
            throw new Error(`Task not found: ${id}`);
          }
          await transitionTaskStatus({ task, status, paths });
        }
        console.log(`task ${id} -> ${nextStatus}`);
      },
    )
    .command(
      "note <id> <role> [content..]",
      "save a task note",
      (y: Argv) =>
        withUsageOptions({
          parser: y
            .positional("id", { type: "string" })
            .positional("role", { type: "string" })
            .positional("content", { type: "string", array: true }),
        }),
      async (
        argv: ArgumentsCamelCase<{
          id: string;
          role: string;
          content?: (string | number)[];
          tok?: number;
          cost?: number;
          judgeTok?: number;
          judgeCost?: number;
        }>,
      ) => {
        const id = requireValue({ value: argv.id as string | undefined, label: "task id" });
        const role = requireValue({ value: argv.role as string | undefined, label: "role" });
        const content = (argv.content ?? []).map(String).join(" ").trim();
        if (role !== "slave" && role !== "judge") {
          throw new Error("Role must be slave or judge");
        }
        if (!content) {
          throw new Error("Missing note content");
        }
        const usage = getUsageFromArgs({ argv });
        const handled = await tryIpc({
          type: "task_note",
          payload: { taskId: id, role, content, usage },
        });
        if (!handled) {
          await writeHistory({
            historyDir: paths.historyDir,
            taskId: id,
            role,
            content: buildNoteContent({ content }),
          });
          const task = await loadTask({ tasksDir: paths.tasksDir, id });
          if (task && applyTaskUsage({ task, usage })) {
            await saveTask({ tasksDir: paths.tasksDir, task });
            await appendEvent({
              eventsLog: paths.eventsLog,
              event: {
                ts: new Date().toISOString(),
                type: "TASK_USAGE",
                msg: "task usage updated",
                taskId: id,
                slaveId: task.assignedSlaveId,
                data: {
                  tok: task.usage?.tokens,
                  cost: task.usage?.cost,
                  judgeCost: task.usage?.judgeCost,
                },
              },
            });
          }
        }
        console.log(`task ${id} ${role} note saved`);
      },
    )
    .command(
      "handoff <id> <role>",
      "write a task handoff",
      (y: Argv) =>
        withUsageOptions({
          parser: y
            .positional("id", { type: "string" })
            .positional("role", { type: "string" })
            .option("summary", { type: "string", default: "" })
            .option("tests", { type: "string", default: "" })
            .option("diffs", { type: "string", default: "" })
            .option("risks", { type: "string", default: "" }),
        }),
      async (
        argv: ArgumentsCamelCase<{
          id: string;
          role: string;
          summary?: string;
          tests?: string;
          diffs?: string;
          risks?: string;
          tok?: number;
          cost?: number;
          judgeTok?: number;
          judgeCost?: number;
        }>,
      ) => {
        const id = requireValue({ value: argv.id as string | undefined, label: "task id" });
        const role = requireValue({ value: argv.role as string | undefined, label: "role" });
        if (role !== "slave" && role !== "judge") {
          throw new Error("Role must be slave or judge");
        }
        const summary = String(argv.summary ?? "");
        const tests = String(argv.tests ?? "");
        const diffs = String(argv.diffs ?? "");
        const risks = String(argv.risks ?? "");
        const task = await loadTask({ tasksDir: paths.tasksDir, id });
        const autoDiffs =
          diffs.length > 0
            ? diffs
            : role === "slave" && task?.slaveCommitSha
              ? `commit: ${task.slaveCommitSha}`
              : diffs;
        const usage = getUsageFromArgs({ argv });
        const handled = await tryIpc({
          type: "task_handoff",
          payload: { taskId: id, role, summary, tests, diffs: autoDiffs, risks, usage },
        });
        if (!handled) {
          const content = buildHandoffContent({
            role,
            summary,
            tests,
            diffs: autoDiffs,
            risks,
          });
          await writeHistory({ historyDir: paths.historyDir, taskId: id, role, content });
          if (task && applyTaskUsage({ task, usage })) {
            await saveTask({ tasksDir: paths.tasksDir, task });
            await appendEvent({
              eventsLog: paths.eventsLog,
              event: {
                ts: new Date().toISOString(),
                type: "TASK_USAGE",
                msg: "task usage updated",
                taskId: id,
                slaveId: task.assignedSlaveId,
                data: {
                  tok: task.usage?.tokens,
                  cost: task.usage?.cost,
                  judgeCost: task.usage?.judgeCost,
                },
              },
            });
          }
        }
        console.log(`task ${id} ${role} handoff saved`);
      },
    )
    .command(
      "healthcheck <id>",
      "queue a healthcheck task",
      (y: Argv) => y.positional("id", { type: "string" }),
      async (argv: ArgumentsCamelCase<{ id: string }>) => {
        const id = requireValue({ value: argv.id as string | undefined, label: "task id" });
        const prompt =
          "Verify main behavior matches current plan. Run the minimal app checks and report pass/fail.";
        const handled = await tryIpc({
          type: "task_create",
          payload: { task: { id, status: "queued", prompt } },
        });
        if (!handled) {
          await saveTask({
            tasksDir: paths.tasksDir,
            task: {
              id,
              status: "queued",
              prompt,
            },
          });
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "TASK_CREATED",
              msg: "health-check task created",
              taskId: id,
            },
          });
        }
        console.log(`health-check task ${id} queued`);
      },
    )
    .command(
      "gc",
      "archive old tasks",
      (y: Argv) => y.option("days", { type: "number", default: 30 }),
      async (argv: ArgumentsCamelCase<{ days?: number }>) => {
        const days = Number(argv.days ?? 30);
        if (!Number.isFinite(days) || days <= 0) {
          throw new Error("Invalid --days value");
        }
        await mkdir(paths.archiveTasksDir, { recursive: true });
        const files = await readdir(paths.tasksDir);
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        let moved = 0;
        for (const file of files) {
          if (!file.endsWith(".json")) {
            continue;
          }
          const source = join(paths.tasksDir, file);
          const stats = await stat(source);
          if (stats.mtimeMs < cutoff) {
            await rename(source, join(paths.archiveTasksDir, file));
            moved += 1;
          }
        }
        console.log(`task gc moved ${moved} file(s)`);
      },
    )
    .demandCommand(1, "Usage: clanker task add|status|note|handoff|healthcheck|gc ...");

  await parser.parseAsync();
};
