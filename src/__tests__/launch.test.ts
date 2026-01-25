import { buildTmuxAttachCommands } from "../commands/launch.js";

describe("buildTmuxAttachCommands", () => {
  test("builds attach commands per window", () => {
    const commands = buildTmuxAttachCommands({
      sessionName: "clanker-test",
      windowNames: ["dashboard", "planner-1", "slave-1"],
    });
    expect(commands).toEqual([
      "'tmux' 'attach-session' '-t' 'clanker-test:dashboard'",
      "'tmux' 'attach-session' '-t' 'clanker-test:planner-1'",
      "'tmux' 'attach-session' '-t' 'clanker-test:slave-1'",
    ]);
  });

  test("includes tmux socket when provided", () => {
    const commands = buildTmuxAttachCommands({
      sessionName: "clanker-socket",
      windowNames: ["dashboard"],
      tmuxSocket: "/tmp/tmux.sock",
    });
    expect(commands).toEqual([
      "'tmux' '-S' '/tmp/tmux.sock' 'attach-session' '-t' 'clanker-socket:dashboard'",
    ]);
  });
});
