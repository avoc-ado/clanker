import { buildTmuxAttachCommands } from "../commands/launch.js";

describe("buildTmuxAttachCommands", () => {
  test("builds attach commands per window", () => {
    const commands = buildTmuxAttachCommands({
      targets: [
        { sessionName: "clanker-test-dashboard", windowName: "dashboard" },
        { sessionName: "clanker-test-planner-1", windowName: "planner-1" },
        { sessionName: "clanker-test-slave-1", windowName: "slave-1" },
      ],
    });
    expect(commands).toEqual([
      "tmux attach-session -t 'clanker-test-dashboard' \\; select-window -t 'clanker-test-dashboard:dashboard'",
      "tmux attach-session -t 'clanker-test-planner-1' \\; select-window -t 'clanker-test-planner-1:planner-1'",
      "tmux attach-session -t 'clanker-test-slave-1' \\; select-window -t 'clanker-test-slave-1:slave-1'",
    ]);
  });

  test("includes tmux socket when provided", () => {
    const commands = buildTmuxAttachCommands({
      targets: [{ sessionName: "clanker-socket-dashboard", windowName: "dashboard" }],
      tmuxSocket: "/tmp/tmux.sock",
    });
    expect(commands).toEqual([
      "tmux -S '/tmp/tmux.sock' attach-session -t 'clanker-socket-dashboard' \\; select-window -t 'clanker-socket-dashboard:dashboard'",
    ]);
  });
});
