import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import type { TaskStatus } from "../state/tasks.js";
import { saveTask, loadTask } from "../state/tasks.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { writeHistory } from "../state/history.js";
import { TASK_SCHEMA } from "../plan/schema.js";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import type { Argv, ArgumentsCamelCase } from "yargs";

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
}): {
  tokens?: number;
  cost?: number;
  judgeTokens?: number;
  judgeCost?: number;
} => {
  return {
    tokens: parseOptionalNumber({ value: argv.tok }),
    cost: parseOptionalNumber({ value: argv.cost }),
    judgeTokens: parseOptionalNumber({ value: argv.judgeTok }),
    judgeCost: parseOptionalNumber({ value: argv.judgeCost }),
  };
};

export const runTask = async ({ args }: { args: string[] }): Promise<void> => {
  const repoRoot = process.cwd();
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
          .positional("prompt", { type: "string", array: true }),
      async (
        argv: ArgumentsCamelCase<{
          id: string;
          prompt?: (string | number)[];
        }>,
      ) => {
        const id = requireValue({ value: argv.id as string | undefined, label: "task id" });
        const prompt = (argv.prompt ?? []).map(String).join(" ").trim();
        if (!prompt) {
          throw new Error("Missing prompt text");
        }
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
            msg: "task created",
            taskId: id,
          },
        });
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
        const task = await loadTask({ tasksDir: paths.tasksDir, id });
        if (!task) {
          throw new Error(`Task not found: ${id}`);
        }
        await transitionTaskStatus({ task, status, paths });
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
        await writeHistory({ historyDir: paths.historyDir, taskId: id, role, content });
        const usage = getUsageFromArgs({ argv });
        if (usage.tokens || usage.cost || usage.judgeCost || usage.judgeTokens) {
          const task = await loadTask({ tasksDir: paths.tasksDir, id });
          if (task) {
            task.usage = {
              tokens: usage.tokens ?? task.usage?.tokens ?? 0,
              cost: usage.cost ?? task.usage?.cost ?? 0,
              judgeTokens: usage.judgeTokens ?? task.usage?.judgeTokens,
              judgeCost: usage.judgeCost ?? task.usage?.judgeCost,
            };
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
                  tok: task.usage.tokens,
                  cost: task.usage.cost,
                  judgeCost: task.usage.judgeCost,
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
        const content = [
          `# ${role} handoff`,
          "",
          "## Summary",
          summary || "(none)",
          "",
          "## Tests",
          tests || "(not provided)",
          "",
          "## Diffs",
          diffs || "(not provided)",
          "",
          "## Risks",
          risks || "(none)",
          "",
        ].join("\n");
        await writeHistory({ historyDir: paths.historyDir, taskId: id, role, content });
        const usage = getUsageFromArgs({ argv });
        if (usage.tokens || usage.cost || usage.judgeCost || usage.judgeTokens) {
          const task = await loadTask({ tasksDir: paths.tasksDir, id });
          if (task) {
            task.usage = {
              tokens: usage.tokens ?? task.usage?.tokens ?? 0,
              cost: usage.cost ?? task.usage?.cost ?? 0,
              judgeTokens: usage.judgeTokens ?? task.usage?.judgeTokens,
              judgeCost: usage.judgeCost ?? task.usage?.judgeCost,
            };
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
                  tok: task.usage.tokens,
                  cost: task.usage.cost,
                  judgeCost: task.usage.judgeCost,
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
