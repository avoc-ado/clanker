import type { TmuxPane } from "../tmux.js";
import { selectPlannerPane } from "../commands/plan.js";

const makePane = ({ id, title }: { id: string; title: string }): TmuxPane => ({
  paneId: id,
  title,
});

describe("selectPlannerPane", () => {
  test("prefers default planner pane", () => {
    const panes = [
      makePane({ id: "%1", title: "clanker:planner-2" }),
      makePane({ id: "%2", title: "clanker:planner-1" }),
      makePane({ id: "%3", title: "clanker:planner-3" }),
    ];
    expect(selectPlannerPane({ panes })?.paneId).toBe("%2");
  });

  test("orders numeric planner ids", () => {
    const panes = [
      makePane({ id: "%1", title: "planner-10" }),
      makePane({ id: "%2", title: "planner-2" }),
    ];
    expect(selectPlannerPane({ panes })?.paneId).toBe("%2");
  });

  test("orders non-numeric planner ids lexicographically", () => {
    const panes = [
      makePane({ id: "%1", title: "planner-beta" }),
      makePane({ id: "%2", title: "planner-alpha" }),
    ];
    expect(selectPlannerPane({ panes })?.paneId).toBe("%2");
  });

  test("returns null when no planner pane exists", () => {
    const panes = [makePane({ id: "%1", title: "slave-1" })];
    expect(selectPlannerPane({ panes })).toBeNull();
  });
});
