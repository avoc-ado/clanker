import {
  formatDateDivider,
  formatDateKey,
  formatShortTime,
  formatStreamLine,
} from "../dashboard/stream-format.js";

describe("stream-format", () => {
  test("formatShortTime returns HH:MM", () => {
    const value = formatShortTime({ date: new Date("2024-05-01T12:34:00Z") });
    expect(value).toMatch(/^\d{2}:\d{2}$/);
  });

  test("formatDateKey returns yyyy-mm-dd", () => {
    const value = formatDateKey({ date: new Date("2024-05-01T12:34:00Z") });
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("formatDateDivider includes year", () => {
    const divider = formatDateDivider({ date: new Date("2024-05-01T12:34:00Z") });
    expect(divider).toContain("2024");
    expect(divider).toContain("----");
  });

  test("formatStreamLine formats known events", () => {
    const line = formatStreamLine({
      event: {
        ts: "2024-05-01T12:34:00Z",
        type: "TASK_DONE",
        msg: "status → done",
        taskId: "task-1",
        slaveId: "c1",
      },
    });
    expect(line?.line).toContain("task-1");
    expect(line?.line).toContain("status");
  });

  test("formatStreamLine ignores unknown events", () => {
    const line = formatStreamLine({
      event: {
        ts: "2024-05-01T12:34:00Z",
        type: "UNKNOWN_EVENT",
        msg: "noop",
      },
    });
    expect(line).toBeNull();
  });
});
