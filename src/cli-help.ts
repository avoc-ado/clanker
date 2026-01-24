export const getCliHelp = (): string => `clanker — agent harness

Usage:
  clanker [command] [options]

Commands:
  (default) launch tmux session + panes
  dashboard
  planner
  slave [id]
  judge
  status
  tail
  resume
  relaunch
  task <subcommand>
  health
  doctor

Options:
  --codex-command <cmd>
  --codex-tty
  --disable-codex
  --prompt-file <path>
  --attach
  -h, --help
`;
