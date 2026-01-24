import type { ClankerRole } from "../prompting/role-prompts.js";

const PROMPT_MARKER = /^\u203A/;
const WORKING_MATCH = "esc to interrupt";

export interface CodexPaneState {
  hasPrompt: boolean;
  isWorking: boolean;
  isPaused: boolean;
  hasEscalation: boolean;
}

export interface PendingAction {
  kind: "pause" | "resume";
  role: ClankerRole;
  requestedAt: number;
  lastSentAt?: number;
}

export const inspectCodexPane = async ({
  paneId,
  capturePane,
  hasEscalationPrompt,
}: {
  paneId: string;
  capturePane: ({ paneId, lines }: { paneId: string; lines: number }) => Promise<string>;
  hasEscalationPrompt: ({ content }: { content: string }) => boolean;
}): Promise<CodexPaneState> => {
  const content = await capturePane({ paneId, lines: 80 });
  const lines = content.split("\n");
  const hasPrompt = lines.some((line) => PROMPT_MARKER.test(line.trimStart()));
  const hasEscalation = hasEscalationPrompt({ content });
  const isWorking = lines.some(
    (line) => line.includes("Working") && line.toLowerCase().includes(WORKING_MATCH),
  );
  const isPaused = lines.some((line) => line.toLowerCase().includes("paused"));
  return { hasPrompt, isWorking, isPaused, hasEscalation };
};

export const shouldSendAction = ({
  action,
  nowMs,
  retryMs,
}: {
  action: PendingAction;
  nowMs: number;
  retryMs: number;
}): boolean => {
  if (!action.lastSentAt) {
    return true;
  }
  return nowMs - action.lastSentAt > retryMs;
};

export const processPendingActions = async ({
  pendingActions,
  inspectPane,
  sendKey,
  retryMs,
  nowMs,
}: {
  pendingActions: Map<string, PendingAction>;
  inspectPane: ({ paneId }: { paneId: string }) => Promise<CodexPaneState>;
  sendKey: ({ paneId, key }: { paneId: string; key: string }) => Promise<void>;
  retryMs: number;
  nowMs: number;
}): Promise<void> => {
  for (const [paneId, action] of pendingActions) {
    const state = await inspectPane({ paneId });
    if (action.kind === "pause") {
      if (state.hasEscalation) {
        continue;
      }
      if (state.isPaused || !state.isWorking) {
        pendingActions.delete(paneId);
        continue;
      }
      if (shouldSendAction({ action, nowMs, retryMs })) {
        await sendKey({ paneId, key: "Escape" });
        pendingActions.set(paneId, { ...action, lastSentAt: nowMs });
      }
      continue;
    }
    if (!state.isPaused) {
      pendingActions.delete(paneId);
      continue;
    }
    if (shouldSendAction({ action, nowMs, retryMs })) {
      await sendKey({ paneId, key: "Escape" });
      pendingActions.set(paneId, { ...action, lastSentAt: nowMs });
    }
  }
};

export const maybeSendBasePrompt = async ({
  paneId,
  role,
  basePromptSent,
  inspectPane,
  sendKeys,
  buildBasePrompt,
}: {
  paneId: string;
  role: ClankerRole;
  basePromptSent: Set<string>;
  inspectPane: ({ paneId }: { paneId: string }) => Promise<CodexPaneState>;
  sendKeys: ({ paneId, text }: { paneId: string; text: string }) => Promise<void>;
  buildBasePrompt: ({ role }: { role: ClankerRole }) => string;
}): Promise<void> => {
  if (basePromptSent.has(paneId)) {
    return;
  }
  const state = await inspectPane({ paneId });
  if (state.hasEscalation || state.isWorking || !state.hasPrompt) {
    return;
  }
  const prompt = buildBasePrompt({ role });
  await sendKeys({ paneId, text: prompt });
  basePromptSent.add(paneId);
};
