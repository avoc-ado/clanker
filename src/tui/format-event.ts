import type { ClankerEvent } from "../state/events.js";
import { TAG_COLORS } from "./colors.js";

const formatCompactNumber = ({ value, decimals }: { value: number; decimals: number }): string => {
  const raw = value.toFixed(decimals);
  return raw.replace(/\.0+$/, "");
};

const formatTokens = ({ tokens }: { tokens: number }): string => {
  if (tokens >= 1000) {
    return `${formatCompactNumber({ value: tokens / 1000, decimals: 1 })}k`;
  }
  return `${tokens}`;
};

const formatElapsed = ({ ts }: { ts: string }): string => {
  const start = new Date(ts).getTime();
  const deltaMs = Date.now() - start;
  const minutes = Math.floor(deltaMs / (60 * 1000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo`;
};

const tagFromType = ({ type }: { type: string }): string => {
  switch (type) {
    case "TASK_ERROR":
      return "BLOK";
    case "TASK_REWORK":
      return "RISK";
    case "TASK_BLOCKED":
    case "TASK_FAILED":
      return "BLOK";
    case "TEST_FAIL":
      return "TEST";
    case "TEST_PASS":
      return "TEST";
    case "TASK_DONE":
      return "DONE";
    case "TASK_NEEDS_JUDGE":
      return "INFO";
    case "TASK_USAGE":
      return "INFO";
    case "SLAVE_READY":
    case "IDLE":
    default:
      return "INFO";
  }
};

const colorizeTag = ({ tag }: { tag: string }): string => {
  const color = TAG_COLORS[tag.trim() as keyof typeof TAG_COLORS] ?? "gray";
  return `{${color}-fg}${tag}{/}`;
};

export const formatEventLine = ({ event }: { event: ClankerEvent }): string => {
  const tag = tagFromType({ type: event.type }).padEnd(4, " ");
  const elapsed = formatElapsed({ ts: event.ts });
  const tokens = typeof event.data?.tok === "number" ? event.data.tok : 0;
  const cost = typeof event.data?.cost === "number" ? event.data.cost : 0;
  const judgeCost = typeof event.data?.judgeCost === "number" ? event.data.judgeCost : 0;
  const slave = event.slaveId ?? "-";
  const task = event.taskId ?? "-";
  const message = event.msg ?? "";

  const tokenPart = `tok ${formatTokens({ tokens })} $${formatCompactNumber({ value: cost, decimals: 2 })}`;
  const shouldHighlightJudge = cost > 0 && judgeCost / cost > 0.15;
  const judgePart = judgeCost
    ? shouldHighlightJudge
      ? `{red-fg} judge $${formatCompactNumber({ value: judgeCost, decimals: 2 })}{/}`
      : ` judge $${formatCompactNumber({ value: judgeCost, decimals: 2 })}`
    : "";

  const line = `${tag} | t+${elapsed} | ${tokenPart}${judgePart} | ${slave} | ${task} | ${message}`;
  const clipped = line.length > 140 ? `${line.slice(0, 139)}…` : line;
  return clipped.replace(tag, colorizeTag({ tag }));
};

export const formatRibbonLine = ({ event }: { event: ClankerEvent }): string => {
  const tag = tagFromType({ type: event.type }).padEnd(4, " ");
  const task = event.taskId ?? "-";
  const slave = event.slaveId ?? "-";
  const message = event.msg ?? "";
  const line = `${tag} ${task} ${slave} ${message}`;
  const clipped = line.length > 120 ? `${line.slice(0, 119)}…` : line;
  return clipped.replace(tag, colorizeTag({ tag }));
};
