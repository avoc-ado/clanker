import {
  formatDateDivider,
  formatDateKey,
  formatShortTime,
  formatStreamLine,
} from "../dashboard/stream-format.js";

describe("stream format", () => {
  test("formatShortTime uses HH:MM", () => {
    const date = new Date(2025, 0, 2, 3, 4, 5);
    expect(formatShortTime({ date })).toBe("03:04");
  });

  test("formatDateDivider includes label", () => {
    const date = new Date(2025, 0, 2, 3, 4, 5);
    const divider = formatDateDivider({ date });
    expect(divider).toContain("----");
    expect(divider).toContain("2025");
  });

  test("formatDateKey uses YYYY-MM-DD", () => {
    const date = new Date(2025, 4, 6, 3, 4, 5);
    expect(formatDateKey({ date })).toBe("2025-05-06");
  });

  test("formatStreamLine returns null for unknown event", () => {
    const result = formatStreamLine({
      event: {
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        type: "UNKNOWN",
        msg: "",
      },
    });
    expect(result).toBeNull();
  });

  test("formatStreamLine includes ids and message", () => {
    const result = formatStreamLine({
      event: {
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        type: "TASK_PROMPTED",
        msg: "sent task prompt",
        taskId: "t1",
        slaveId: "c2",
      },
    });
    expect(result).not.toBeNull();
    if (!result) {
      return;
    }
    expect(result.line).toContain("t1");
    expect(result.line).toContain("@c2");
    expect(result.line).toContain("sent task prompt");
  });

  test("formatStreamLine omits missing parts", () => {
    const result = formatStreamLine({
      event: {
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        type: "PAUSED",
        msg: "",
      },
    });
    expect(result).not.toBeNull();
    if (!result) {
      return;
    }
    expect(result.line).not.toContain("@");
  });
});
