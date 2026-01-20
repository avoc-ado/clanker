import { formatEventLine } from "../tui/format-event.js";
import { formatRibbonLine } from "../tui/format-event.js";

describe("formatEventLine", () => {
  test("includes tag and tokens", () => {
    const ts = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const line = formatEventLine({
      event: {
        ts,
        type: "TASK_DONE",
        msg: "done",
        slaveId: "c1",
        taskId: "t1",
        data: { tok: 1200, cost: 0.41 },
      },
    });
    expect(line).toContain("DONE");
    expect(line).toContain("tok 1.2k");
    expect(line).toContain("$0.41");
  });

  test("formats ribbon line", () => {
    const line = formatRibbonLine({
      event: { ts: new Date().toISOString(), type: "TASK_REWORK", msg: "needs fix", taskId: "t9" },
    });
    expect(line).toContain("RISK");
    expect(line).toContain("t9");
  });
});
