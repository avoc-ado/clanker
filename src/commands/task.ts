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

const requireValue = ({ value, label }: { value: string | undefined; label: string }): string => {
  if (!value || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const parseFlag = ({
  args,
  name,
}: {
  args: string[];
  name: string;
}): { value: string | null; remaining: string[] } => {
  const remaining: string[] = [];
  let value: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === name && i + 1 < args.length) {
      value = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      value = arg.slice(name.length + 1);
      continue;
    }
    remaining.push(arg);
  }
  return { value, remaining };
};

const parseUsageFlags = ({
  args,
}: {
  args: string[];
}): {
  tokens?: number;
  cost?: number;
  judgeTokens?: number;
  judgeCost?: number;
  remaining: string[];
} => {
  let next = args;
  const tok = parseFlag({ args: next, name: "--tok" });
  next = tok.remaining;
  const cost = parseFlag({ args: next, name: "--cost" });
  next = cost.remaining;
  const judgeTok = parseFlag({ args: next, name: "--judge-tok" });
  next = judgeTok.remaining;
  const judgeCost = parseFlag({ args: next, name: "--judge-cost" });
  next = judgeCost.remaining;

  const parseNum = (value: string | null): number | undefined => {
    if (!value) {
      return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };

  return {
    tokens: parseNum(tok.value),
    cost: parseNum(cost.value),
    judgeTokens: parseNum(judgeTok.value),
    judgeCost: parseNum(judgeCost.value),
    remaining: next,
  };
};

export const runTask = async ({ args }: { args: string[] }): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });

  const [subcommand, idRaw, ...rest] = args;
  if (subcommand === "add") {
    const id = requireValue({ value: idRaw, label: "task id" });
    const prompt = rest.join(" ").trim();
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
    return;
  }

  if (subcommand === "status") {
    const id = requireValue({ value: idRaw, label: "task id" });
    const nextStatus = requireValue({ value: rest[0], label: "status" });
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
    return;
  }

  if (subcommand === "note") {
    const id = requireValue({ value: idRaw, label: "task id" });
    const role = requireValue({ value: rest[0], label: "role" });
    const usage = parseUsageFlags({ args: rest.slice(1) });
    const content = usage.remaining.join(" ").trim();
    if (role !== "slave" && role !== "judge") {
      throw new Error("Role must be slave or judge");
    }
    if (!content) {
      throw new Error("Missing note content");
    }
    await writeHistory({ historyDir: paths.historyDir, taskId: id, role, content });
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
    return;
  }

  if (subcommand === "handoff") {
    const id = requireValue({ value: idRaw, label: "task id" });
    const role = requireValue({ value: rest[0], label: "role" });
    if (role !== "slave" && role !== "judge") {
      throw new Error("Role must be slave or judge");
    }
    const summaryFlag = parseFlag({ args: rest.slice(1), name: "--summary" });
    const testsFlag = parseFlag({ args: summaryFlag.remaining, name: "--tests" });
    const diffsFlag = parseFlag({ args: testsFlag.remaining, name: "--diffs" });
    const risksFlag = parseFlag({ args: diffsFlag.remaining, name: "--risks" });
    const usage = parseUsageFlags({ args: risksFlag.remaining });
    const summary = summaryFlag.value ?? "";
    const tests = testsFlag.value ?? "";
    const diffs = diffsFlag.value ?? "";
    const risks = risksFlag.value ?? "";

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
    return;
  }

  if (subcommand === "healthcheck") {
    const id = requireValue({ value: idRaw, label: "task id" });
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
    return;
  }

  if (subcommand === "gc") {
    const daysFlag = parseFlag({ args: rest, name: "--days" });
    const days = Number(daysFlag.value ?? "30");
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
    return;
  }

  throw new Error("Usage: clanker task add|status|note|handoff|healthcheck|gc ...");
};
