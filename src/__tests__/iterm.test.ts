import { buildGridLayout, buildItermScript } from "../iterm.js";

describe("iterm launcher", () => {
  test("buildGridLayout spreads rows across columns", () => {
    const layout = buildGridLayout({ paneCount: 6 });
    expect(layout.maxRows).toBe(2);
    expect(layout.columns.map((rows) => rows.length)).toEqual([2, 2, 2]);
  });

  test("buildGridLayout handles uneven panes", () => {
    const layout = buildGridLayout({ paneCount: 5 });
    expect(layout.columns.map((rows) => rows.length)).toEqual([2, 2, 1]);
  });

  test("buildItermScript writes commands in panes", () => {
    const commands = ["echo one", "echo two", "echo three"];
    const script = buildItermScript({ cwd: "/tmp/repo", commands });
    const writeLines = script.filter((line) => line.includes("write text"));
    expect(script[0]).toContain('tell application "iTerm"');
    expect(writeLines).toHaveLength(commands.length);
    expect(script.join("\n")).toContain("cd '/tmp/repo'; echo one");
  });
});
