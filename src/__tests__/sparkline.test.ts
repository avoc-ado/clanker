import { sparkline } from "../format/sparkline.js";

describe("sparkline", () => {
  test("renders empty string for empty input", () => {
    expect(sparkline({ values: [] })).toBe("");
  });

  test("renders ascii bars", () => {
    const line = sparkline({ values: [0, 1, 2, 3] });
    expect(line.length).toBe(4);
  });

  test("renders blanks for non-positive max", () => {
    expect(sparkline({ values: [-2, -1, 0] })).toBe("   ");
  });

  test("renders blanks when max is zero", () => {
    expect(sparkline({ values: [0, 0] })).toBe("  ");
  });
});
