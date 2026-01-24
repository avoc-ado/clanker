import {
  inspectCodexPane,
  maybeSendBasePrompt,
  processPendingActions,
  shouldSendAction,
  type PendingAction,
} from "../dashboard/pending-actions.js";
import { ClankerRole } from "../prompting/role-prompts.js";

describe("shouldSendAction", () => {
  const baseAction: PendingAction = {
    kind: "pause",
    role: ClankerRole.Planner,
    requestedAt: 0,
  };

  test("returns true when action was never sent", () => {
    expect(shouldSendAction({ action: baseAction, nowMs: 10_000, retryMs: 1_000 })).toBe(true);
  });

  test("returns false when within retry window", () => {
    const action: PendingAction = { ...baseAction, lastSentAt: 10_000 };
    expect(shouldSendAction({ action, nowMs: 10_500, retryMs: 1_000 })).toBe(false);
  });

  test("returns true after retry window", () => {
    const action: PendingAction = { ...baseAction, lastSentAt: 10_000 };
    expect(shouldSendAction({ action, nowMs: 11_001, retryMs: 1_000 })).toBe(true);
  });
});

describe("inspectCodexPane", () => {
  test("parses prompt, working, paused, and escalation flags", async () => {
    const content = [
      "› prompt here",
      "Working (esc to interrupt)",
      "paused",
      "Press enter to confirm",
    ].join("\n");
    const capturePane = async () => content;
    const hasEscalationPrompt = ({ content: raw }: { content: string }) => raw.includes("confirm");
    const state = await inspectCodexPane({
      paneId: "pane-1",
      capturePane,
      hasEscalationPrompt,
    });
    expect(state.hasPrompt).toBe(true);
    expect(state.isWorking).toBe(true);
    expect(state.isPaused).toBe(true);
    expect(state.hasEscalation).toBe(true);
  });
});

describe("processPendingActions", () => {
  test("sends pause/resume keys and clears actions", async () => {
    const pendingActions = new Map<string, PendingAction>();
    pendingActions.set("pane-pause", {
      kind: "pause",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });
    pendingActions.set("pane-resume", {
      kind: "resume",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });
    let phase = 0;
    const inspectPane = async ({ paneId }: { paneId: string }) => {
      if (paneId === "pane-pause") {
        return {
          hasPrompt: true,
          isWorking: phase === 0,
          isPaused: phase !== 0,
          hasEscalation: false,
        };
      }
      return {
        hasPrompt: true,
        isWorking: true,
        isPaused: phase === 0,
        hasEscalation: false,
      };
    };
    const sendKeyCalls: Array<{ paneId: string; key: string }> = [];
    const sendKey = async ({ paneId, key }: { paneId: string; key: string }) => {
      sendKeyCalls.push({ paneId, key });
    };

    await processPendingActions({
      pendingActions,
      inspectPane,
      sendKey,
      retryMs: 1,
      nowMs: 1_000,
    });

    phase = 1;
    await processPendingActions({
      pendingActions,
      inspectPane,
      sendKey,
      retryMs: 1,
      nowMs: 2_000,
    });

    expect(sendKeyCalls.length).toBeGreaterThan(0);
    expect(pendingActions.size).toBe(0);
  });

  test("skips pause when escalation present and clears resume when not paused", async () => {
    const pendingActions = new Map<string, PendingAction>();
    pendingActions.set("pane-pause", {
      kind: "pause",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });
    pendingActions.set("pane-resume", {
      kind: "resume",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });
    const inspectPane = async ({ paneId }: { paneId: string }) => {
      if (paneId === "pane-pause") {
        return {
          hasPrompt: true,
          isWorking: true,
          isPaused: false,
          hasEscalation: true,
        };
      }
      return {
        hasPrompt: true,
        isWorking: true,
        isPaused: false,
        hasEscalation: false,
      };
    };
    const sendKeyCalls: Array<{ paneId: string; key: string }> = [];
    const sendKey = async ({ paneId, key }: { paneId: string; key: string }) => {
      sendKeyCalls.push({ paneId, key });
    };

    await processPendingActions({
      pendingActions,
      inspectPane,
      sendKey,
      retryMs: 1,
      nowMs: 1_000,
    });

    expect(sendKeyCalls.length).toBe(0);
    expect(pendingActions.has("pane-pause")).toBe(true);
    expect(pendingActions.has("pane-resume")).toBe(false);
  });

  test("clears pause when no longer working", async () => {
    const pendingActions = new Map<string, PendingAction>();
    pendingActions.set("pane-pause", {
      kind: "pause",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: false,
      isPaused: false,
      hasEscalation: false,
    });
    const sendKey = async () => undefined;

    await processPendingActions({
      pendingActions,
      inspectPane,
      sendKey,
      retryMs: 1,
      nowMs: 1_000,
    });

    expect(pendingActions.size).toBe(0);
  });

  test("skips resend when retry window not elapsed", async () => {
    const pendingActions = new Map<string, PendingAction>();
    pendingActions.set("pane-resume", {
      kind: "resume",
      role: ClankerRole.Slave,
      requestedAt: 0,
      lastSentAt: 900,
    });
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: true,
      isPaused: true,
      hasEscalation: false,
    });
    let sendCount = 0;
    const sendKey = async () => {
      sendCount += 1;
    };

    await processPendingActions({
      pendingActions,
      inspectPane,
      sendKey,
      retryMs: 200,
      nowMs: 1_000,
    });

    expect(sendCount).toBe(0);
    expect(pendingActions.size).toBe(1);
  });
});

describe("maybeSendBasePrompt", () => {
  test("returns early when prompt already sent", async () => {
    const basePromptSent = new Set<string>(["pane-1"]);
    let inspectCalls = 0;
    const inspectPane = async () => {
      inspectCalls += 1;
      return {
        hasPrompt: true,
        isWorking: false,
        isPaused: false,
        hasEscalation: false,
      };
    };
    let sendCalls = 0;
    const sendKeys = async () => {
      sendCalls += 1;
    };

    await maybeSendBasePrompt({
      paneId: "pane-1",
      role: ClankerRole.Planner,
      basePromptSent,
      inspectPane,
      sendKeys,
      buildBasePrompt: () => "prompt",
    });

    expect(inspectCalls).toBe(0);
    expect(sendCalls).toBe(0);
  });

  test("skips when pane working or escalated or missing prompt", async () => {
    const basePromptSent = new Set<string>();
    const inspectPane = async () => ({
      hasPrompt: false,
      isWorking: true,
      isPaused: false,
      hasEscalation: true,
    });
    let sendCalls = 0;
    const sendKeys = async () => {
      sendCalls += 1;
    };

    await maybeSendBasePrompt({
      paneId: "pane-2",
      role: ClankerRole.Planner,
      basePromptSent,
      inspectPane,
      sendKeys,
      buildBasePrompt: () => "prompt",
    });

    expect(sendCalls).toBe(0);
    expect(basePromptSent.has("pane-2")).toBe(false);
  });

  test("sends base prompt when idle at prompt", async () => {
    const basePromptSent = new Set<string>();
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: false,
      isPaused: false,
      hasEscalation: false,
    });
    const sent: Array<{ paneId: string; text: string }> = [];
    const sendKeys = async ({ paneId, text }: { paneId: string; text: string }) => {
      sent.push({ paneId, text });
    };

    await maybeSendBasePrompt({
      paneId: "pane-3",
      role: ClankerRole.Planner,
      basePromptSent,
      inspectPane,
      sendKeys,
      buildBasePrompt: ({ role }) => `prompt:${role}`,
    });

    expect(sent).toContainEqual({ paneId: "pane-3", text: `prompt:${ClankerRole.Planner}` });
    expect(basePromptSent.has("pane-3")).toBe(true);
  });
});
