import { buildTmuxAttachCommands } from "../commands/launch.js";

describe("buildTmuxAttachCommands", () => {
  test("builds attach commands per window", () => {
    const commands = buildTmuxAttachCommands({
      sessionName: "clanker-test",
      paneCount: 3,
    });
    expect(commands).toEqual([
      "'tmux' 'attach-session' '-t' 'clanker-test:0'",
      "'tmux' 'attach-session' '-t' 'clanker-test:1'",
      "'tmux' 'attach-session' '-t' 'clanker-test:2'",
    ]);
  });

  test("includes tmux socket when provided", () => {
    const commands = buildTmuxAttachCommands({
      sessionName: "clanker-socket",
      paneCount: 1,
      tmuxSocket: "/tmp/tmux.sock",
    });
    expect(commands).toEqual([
      "'tmux' '-S' '/tmp/tmux.sock' 'attach-session' '-t' 'clanker-socket:0'",
    ]);
  });
});
