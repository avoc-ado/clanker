export interface SlashCommandDefinition {
  name: string;
  description: string;
  usage?: string;
}

export const parseSlashInput = ({
  input,
}: {
  input: string;
}): { hasLeadingSlash: boolean; name: string; rest: string } => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { hasLeadingSlash: false, name: "", rest: "" };
  }
  const withoutSlash = trimmed.slice(1);
  const match = withoutSlash.match(/^\s*([^\s]*)\s*(.*)$/);
  const name = match?.[1] ?? "";
  const rest = match?.[2] ?? "";
  return { hasLeadingSlash: true, name, rest };
};

export const filterSlashCommands = <T extends SlashCommandDefinition>({
  commands,
  token,
}: {
  commands: T[];
  token: string;
}): { exact?: T; matches: T[] } => {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return { matches: commands };
  }
  const exact = commands.find((command) => command.name.toLowerCase() === normalized);
  const prefixMatches = commands.filter((command) =>
    command.name.toLowerCase().startsWith(normalized),
  );
  const matches = exact
    ? [exact, ...prefixMatches.filter((command) => command !== exact)]
    : prefixMatches;
  return { exact, matches };
};

export const formatSlashCommandList = ({
  commands,
}: {
  commands: SlashCommandDefinition[];
}): string[] => {
  return commands.map((command) => `/${command.name} - ${command.description}`);
};

export const getSlashCompletions = <T extends SlashCommandDefinition>({
  commands,
  input,
}: {
  commands: T[];
  input: string;
}): { completions: string[]; completionBase: string } => {
  const parsed = parseSlashInput({ input });
  if (!parsed.hasLeadingSlash) {
    return { completions: [], completionBase: input };
  }
  if (parsed.rest.trim().length > 0) {
    return { completions: [], completionBase: input };
  }
  const { matches } = filterSlashCommands({ commands, token: parsed.name });
  if (matches.length === 0) {
    return { completions: [], completionBase: input };
  }
  if (matches.length === 1) {
    return {
      completions: [`/${matches[0].name} `],
      completionBase: input,
    };
  }
  return {
    completions: matches.map((command) => `/${command.name}`),
    completionBase: input,
  };
};
