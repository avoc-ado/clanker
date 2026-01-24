import type { ClankerPaths } from "../paths.js";
import { loadTask } from "../state/tasks.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { TASK_SCHEMA } from "../plan/schema.js";
import { appendHistoryEntry, saveCommandHistory } from "../state/command-history.js";
import {
  filterSlashCommands,
  formatSlashCommandList,
  parseSlashInput,
  type SlashCommandDefinition,
} from "../commands/slash-commands.js";
import { ClankerRole } from "../prompting/role-prompts.js";

export interface SlashCommandHandler extends SlashCommandDefinition {
  run: ({ args }: { args: string }) => Promise<string | null> | string | null;
}

export type CommandHandler = (value: string) => void;

export const buildDashboardCommands = ({
  paths,
  writeLine,
  setPaused,
  toggleFocus,
  runRelaunch,
}: {
  paths: ClankerPaths;
  writeLine: (line: string) => void;
  setPaused: ({ paused, role }: { paused: boolean; role: ClankerRole | "all" }) => Promise<void>;
  toggleFocus: () => Promise<void>;
  runRelaunch: ({ args }: { args: string[] }) => Promise<void>;
}): SlashCommandHandler[] => {
  const parseRoleArg = ({ args, commandName }: { args: string; commandName: string }) => {
    const token = args.trim().split(/\s+/)[0];
    if (!token) {
      return "all";
    }
    if (token === "planner") {
      return ClankerRole.Planner;
    }
    if (token === "judge") {
      return ClankerRole.Judge;
    }
    if (token === "slave") {
      return ClankerRole.Slave;
    }
    writeLine(`usage: /${commandName} [planner|judge|slave]`);
    return null;
  };

  const commands: SlashCommandHandler[] = [];
  const writeHelp = () => {
    writeLine(formatSlashCommandList({ commands }).join("\n"));
    return "listed commands";
  };
  commands.push({
    name: "help",
    description: "list dashboard slash commands",
    usage: "/help",
    run: writeHelp,
  });
  commands.push(
    {
      name: "resume",
      description: "resume queued work",
      usage: "/resume",
      run: async ({ args }) => {
        const role = parseRoleArg({ args, commandName: "resume" });
        if (!role) {
          return null;
        }
        await setPaused({ paused: false, role });
        return "resumed work";
      },
    },
    {
      name: "pause",
      description: "pause new work",
      usage: "/pause",
      run: async ({ args }) => {
        const role = parseRoleArg({ args, commandName: "pause" });
        if (!role) {
          return null;
        }
        await setPaused({ paused: true, role });
        return "paused work";
      },
    },
    {
      name: "focus",
      description: "toggle focus to last active slave pane",
      usage: "/focus",
      run: async () => {
        await toggleFocus();
        return "toggled focus";
      },
    },
    {
      name: "relaunch",
      description: "relaunch codex agents",
      usage: "/relaunch [--fresh] [target]",
      run: async ({ args }) => {
        const parts = args.length > 0 ? args.split(/\s+/) : [];
        await runRelaunch({ args: parts });
        return "relaunch requested";
      },
    },
    {
      name: "task",
      description: "set a task status",
      usage: "/task <id> <status>",
      run: async ({ args }) => {
        const [id, status] = args.split(/\s+/);
        if (!id || !status) {
          writeLine("usage: /task <id> <status>");
          return null;
        }
        if (!TASK_SCHEMA.status.includes(status)) {
          writeLine(`invalid status: ${status}`);
          return null;
        }
        const task = await loadTask({ tasksDir: paths.tasksDir, id });
        if (!task) {
          writeLine(`task not found: ${id}`);
          return null;
        }
        await transitionTaskStatus({ task, status: status as typeof task.status, paths });
        return `task ${id} -> ${status}`;
      },
    },
  );
  return commands;
};

export const makeDashboardCommandHandler = ({
  commands,
  commandHistory,
  commandHistoryPath,
  maxEntries,
  writeLine,
  onHistoryUpdated,
  formatLine,
}: {
  commands: SlashCommandHandler[];
  commandHistory: string[];
  commandHistoryPath: string;
  maxEntries: number;
  writeLine: (line: string) => void;
  onHistoryUpdated: (history: string[]) => void;
  formatLine?: (line: string) => string;
}): CommandHandler => {
  const formatOutput = formatLine ?? ((line: string) => line);
  return (raw: string) => {
    const value = raw.trim();
    if (!value) {
      return;
    }
    const parsed = parseSlashInput({ input: value });
    if (!parsed.hasLeadingSlash) {
      writeLine(formatOutput("commands must start with '/'"));
      return;
    }

    const nextHistory = appendHistoryEntry({
      entries: commandHistory,
      entry: value,
      maxEntries,
    });
    commandHistory.splice(0, commandHistory.length, ...nextHistory);
    onHistoryUpdated(commandHistory);
    void saveCommandHistory({ path: commandHistoryPath, entries: commandHistory, maxEntries });

    if (parsed.name.length === 0) {
      const lines = formatSlashCommandList({ commands });
      writeLine(formatOutput(["commands:", ...lines].join("\n")));
      return;
    }

    const { exact, matches } = filterSlashCommands({ commands, token: parsed.name });
    if (!exact || exact.name.toLowerCase() !== parsed.name.toLowerCase()) {
      if (matches.length > 0) {
        const lines = formatSlashCommandList({ commands: matches });
        writeLine(formatOutput([`matches for /${parsed.name}:`, ...lines].join("\n")));
      } else {
        writeLine(formatOutput(`unknown command: /${parsed.name}`));
      }
      return;
    }

    const runArgs = parsed.rest.trim();
    const commandLabel = runArgs.length > 0 ? `/${exact.name} ${runArgs}` : `/${exact.name}`;
    Promise.resolve(exact.run({ args: runArgs }))
      .then((result) => {
        if (!result) {
          return;
        }
        writeLine(formatOutput(`ran ${commandLabel} (${result})`));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        writeLine(formatOutput(`command failed: ${message}`));
      });
  };
};
