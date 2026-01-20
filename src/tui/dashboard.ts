import blessed from "blessed";
import type { ClankerConfig } from "../config.js";
import type { ClankerState } from "../state/state.js";
import type { ClankerEvent } from "../state/events.js";
import { formatEventLine } from "./format-event.js";
import { applyGlitchHeader } from "./glitch.js";
import { PALETTE } from "./palette.js";

export interface DashboardHandle {
  updateStatus: ({
    paneCount,
    slavePaneCount,
    escalation,
    taskCount,
    conflictCount,
    heartbeatCount,
    staleCount,
    paused,
  }: {
    paneCount: number;
    slavePaneCount: number;
    escalation: string;
    taskCount: number;
    conflictCount: number;
    heartbeatCount: number;
    staleCount: number;
    paused: boolean;
  }) => void;
  updateRibbon: ({ lines }: { lines: string[] }) => void;
  updateTail: ({ events }: { events: ClankerEvent[] }) => void;
  destroy: () => void;
}

export const startDashboard = ({
  config,
  state,
  version,
  configSummary,
  onToggleFocus,
  onPause,
  onResume,
  onCommand,
}: {
  config: ClankerConfig;
  state: ClankerState;
  version: string;
  configSummary: string;
  onToggleFocus?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onCommand?: (value: string) => void;
}): DashboardHandle => {
  const screen = blessed.screen({
    smartCSR: true,
    title: "clanker",
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    content: ` clanker  slaves:${config.slaves}  state:${state.paused ? "paused" : "running"}  tasks:${state.tasks.length} `,
    style: {
      fg: PALETTE.fg,
      bg: PALETTE.bg,
    },
  });

  const body = blessed.box({
    top: 3,
    left: 0,
    width: "100%",
    height: "100%-12",
    content: "dashboard booted",
    border: {
      type: "line",
    },
    style: {
      fg: PALETTE.fg,
      border: {
        fg: PALETTE.accent,
      },
    },
  });

  const ribbon = blessed.box({
    top: "100%-9",
    left: 0,
    width: "100%",
    height: 2,
    border: {
      type: "line",
    },
    tags: true,
    content: "feedback: none",
    style: {
      fg: PALETTE.fg,
      border: {
        fg: PALETTE.accent,
      },
    },
  });

  const tail = blessed.box({
    top: "100%-7",
    left: 0,
    width: "100%",
    height: 5,
    border: {
      type: "line",
    },
    tags: true,
    content: "tail: no events",
    style: {
      fg: PALETTE.fg,
      border: {
        fg: PALETTE.accent,
      },
    },
  });

  const commandInput = blessed.textbox({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    inputOnFocus: true,
    hidden: true,
    style: {
      fg: PALETTE.fg,
      bg: PALETTE.bg,
    },
  });

  const footer = blessed.box({
    bottom: 1,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    content: ` v${version}  ${configSummary} `,
    style: {
      fg: PALETTE.fg,
      bg: PALETTE.bg,
    },
  });

  screen.append(header);
  screen.append(body);
  screen.append(ribbon);
  screen.append(tail);
  screen.append(footer);
  screen.append(commandInput);

  screen.key(["q", "C-c"], () => {
    screen.destroy();
  });
  if (onToggleFocus) {
    screen.key(["tab"], () => {
      onToggleFocus();
    });
    screen.key(["b"], () => {
      onToggleFocus();
    });
  }
  if (onPause) {
    screen.key(["p"], () => {
      onPause();
    });
  }
  if (onResume) {
    screen.key(["r"], () => {
      onResume();
    });
  }
  if (onCommand) {
    screen.key(["/"], () => {
      commandInput.show();
      commandInput.setValue("/");
      commandInput.focus();
      screen.render();
    });
    commandInput.on("submit", (value) => {
      onCommand(value.trim());
      commandInput.hide();
      screen.render();
    });
    commandInput.on("cancel", () => {
      commandInput.hide();
      screen.render();
    });
  }

  const stopGlitch = applyGlitchHeader({ screen, box: header, text: "clanker" });
  screen.render();

  const updateStatus = ({
    paneCount,
    slavePaneCount,
    escalation,
    taskCount,
    conflictCount,
    heartbeatCount,
    staleCount,
    paused,
  }: {
    paneCount: number;
    slavePaneCount: number;
    escalation: string;
    taskCount: number;
    conflictCount: number;
    heartbeatCount: number;
    staleCount: number;
    paused: boolean;
  }): void => {
    body.setContent(
      [
        `panes: ${paneCount}`,
        `slave panes: ${slavePaneCount}`,
        `slaves config: ${config.slaves}`,
        `paused: ${paused ? "yes" : "no"}`,
        `escalation: ${escalation}`,
        `tasks: ${taskCount}`,
        `conflicts: ${conflictCount}`,
        `heartbeats: ${heartbeatCount} (stale ${staleCount})`,
      ].join("\n"),
    );
    screen.render();
  };

  const updateTail = ({ events }: { events: ClankerEvent[] }): void => {
    if (events.length === 0) {
      tail.setContent("tail: no events");
      screen.render();
      return;
    }
    const lines = events.map((event) => formatEventLine({ event }));
    tail.setContent(lines.join("\n"));
    screen.render();
  };

  return {
    updateStatus,
    updateRibbon: ({ lines }: { lines: string[] }): void => {
      ribbon.setContent(lines.length > 0 ? lines.join("\n") : "feedback: none");
      screen.render();
    },
    updateTail,
    destroy: () => {
      stopGlitch();
      screen.destroy();
    },
  };
};
