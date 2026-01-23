import type { SlashCommandDefinition } from "../commands/slash-commands.js";
import {
  filterSlashCommands,
  getSlashCompletions,
  parseSlashInput,
} from "../commands/slash-commands.js";

const COMMANDS: SlashCommandDefinition[] = [
  { name: "help", description: "list commands" },
  { name: "pause", description: "pause work" },
  { name: "resume", description: "resume work" },
  { name: "task", description: "set task status" },
];

describe("parseSlashInput", () => {
  test("parses name and rest", () => {
    expect(parseSlashInput({ input: "/task 123 done" })).toEqual({
      hasLeadingSlash: true,
      name: "task",
      rest: "123 done",
    });
  });

  test("returns empty when not a slash command", () => {
    expect(parseSlashInput({ input: "task 123 done" })).toEqual({
      hasLeadingSlash: false,
      name: "",
      rest: "",
    });
  });
});

describe("filterSlashCommands", () => {
  test("returns all commands for empty token", () => {
    expect(filterSlashCommands({ commands: COMMANDS, token: "" }).matches).toHaveLength(4);
  });

  test("filters by prefix", () => {
    const matches = filterSlashCommands({ commands: COMMANDS, token: "pa" }).matches;
    expect(matches.map((command) => command.name)).toEqual(["pause"]);
  });

  test("prefers exact match", () => {
    const { exact, matches } = filterSlashCommands({ commands: COMMANDS, token: "pause" });
    expect(exact?.name).toBe("pause");
    expect(matches[0]?.name).toBe("pause");
  });
});

describe("getSlashCompletions", () => {
  test("returns matches for slash prefix", () => {
    const { completions } = getSlashCompletions({ commands: COMMANDS, input: "/pa" });
    expect(completions).toEqual(["/pause "]);
  });

  test("returns all for bare slash", () => {
    const { completions } = getSlashCompletions({ commands: COMMANDS, input: "/" });
    expect(completions.length).toBe(COMMANDS.length);
  });

  test("returns none when args exist", () => {
    const { completions } = getSlashCompletions({ commands: COMMANDS, input: "/task 1 done" });
    expect(completions).toEqual([]);
  });
});
