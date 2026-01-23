export const getCliHelp = (): string => `clanker — agent harness

Usage:
  clanker [command] [options]

Commands:
  dashboard (default)
  plan
  planner
  slave [id]
  judge
  status
  tail
  resume
  task <subcommand>
  health
  doctor

Options:
  --codex-command <cmd>
  --codex-tty
  --disable-codex
  --prompt-file <path>
  -h, --help
`;
