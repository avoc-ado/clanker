import type { ClankerEvent } from "../state/events.js";

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
} as const;

type AnsiColor = keyof typeof ANSI;

interface StreamTag {
  tag: string;
  color: AnsiColor;
}

const STREAM_TAGS = {
  TASK_PACKET: { tag: "PACK", color: "cyan" },
  TASK_CREATED: { tag: "PACK", color: "cyan" },
  TASK_ASSIGNED: { tag: "WORK", color: "cyan" },
  TASK_PROMPTED: { tag: "WORK", color: "cyan" },
  TASK_NEEDS_JUDGE: { tag: "JUDG", color: "blue" },
  TASK_DONE: { tag: "DONE", color: "green" },
  TASK_REWORK: { tag: "RWRK", color: "magenta" },
  TASK_BLOCKED: { tag: "BLKD", color: "red" },
  TASK_FAILED: { tag: "FAIL", color: "red" },
  TASK_ERROR: { tag: "FAIL", color: "red" },
  TASK_STATUS: { tag: "STAT", color: "gray" },
  TASK_USAGE: { tag: "USGE", color: "gray" },
  PLAN_SENT: { tag: "PLAN", color: "blue" },
  DASH_STATUS: { tag: "STAT", color: "gray" },
} satisfies Record<string, StreamTag>;

export interface StreamLine {
  line: string;
  date: Date;
}

const pad2 = ({ value }: { value: number }): string => `${value}`.padStart(2, "0");

export const formatShortTime = ({ date }: { date: Date }): string => {
  return `${pad2({ value: date.getHours() })}:${pad2({ value: date.getMinutes() })}`;
};

export const formatDateKey = ({ date }: { date: Date }): string => {
  return `${date.getFullYear()}-${pad2({ value: date.getMonth() + 1 })}-${pad2({
    value: date.getDate(),
  })}`;
};

export const formatDateDivider = ({ date }: { date: Date }): string => {
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
  return `${ANSI.gray}---- ${label} ----${ANSI.reset}`;
};

const colorize = ({ value, color }: { value: string; color: AnsiColor }): string => {
  return `${ANSI[color]}${value}${ANSI.reset}`;
};

export const formatStreamLine = ({ event }: { event: ClankerEvent }): StreamLine | null => {
  const style = STREAM_TAGS[event.type as keyof typeof STREAM_TAGS];
  if (!style) {
    return null;
  }
  const date = new Date(event.ts);
  const time = formatShortTime({ date });
  const tag = colorize({ value: style.tag, color: style.color });
  const taskPart = event.taskId ? ` ${event.taskId}` : "";
  const slavePart = event.slaveId ? ` @${event.slaveId}` : "";
  const message = event.msg ? ` ${event.msg}` : "";
  const line = `${time} ${tag}${taskPart}${slavePart}${message}`;
  return { line, date };
};
