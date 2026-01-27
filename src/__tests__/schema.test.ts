import { formatTaskSchema } from "../plan/schema.js";

describe("formatTaskSchema", () => {
  test("includes required fields", () => {
    const schema = formatTaskSchema();
    expect(schema).toContain("id:");
    expect(schema).toContain("status:");
    expect(schema).toContain("prompt:");
    expect(schema).toContain("slaveCommitSha");
    expect(schema).toContain("judgeCheckedOutSha");
  });
});
