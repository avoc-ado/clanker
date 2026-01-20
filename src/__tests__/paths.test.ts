import { getClankerPaths } from "../paths.js";

describe("getClankerPaths", () => {
  test("builds .clanker paths", () => {
    const paths = getClankerPaths({ repoRoot: "/tmp/repo" });
    expect(paths.stateDir).toBe("/tmp/repo/.clanker");
    expect(paths.tasksDir).toBe("/tmp/repo/.clanker/tasks");
    expect(paths.logsDir).toBe("/tmp/repo/.clanker/logs");
    expect(paths.archiveTasksDir).toBe("/tmp/repo/.clanker/archive/tasks");
  });
});
