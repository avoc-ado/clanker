import { spawn } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { attachFilteredPipe, wireStdin } from "../codex/process-io.js";

describe("attachFilteredPipe", () => {
  test("filters yarn install output and forwards others", async () => {
    const source = new PassThrough();
    const outputs: string[] = [];
    const logs: string[] = [];
    const target = new Writable({
      write(chunk, _enc, cb) {
        outputs.push(chunk.toString());
        cb();
      },
    });
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        logs.push(chunk.toString());
        cb();
      },
    });
    attachFilteredPipe({ source, target, logStream });

    source.write("➤ YN0000: step\n");
    source.write("hello world\n");
    source.write("line with cr\r\n");
    source.end("tail");

    await new Promise((resolve) => source.on("end", resolve));

    expect(outputs.join("")).toContain("hello world\n");
    expect(outputs.join("")).toContain("line with cr\r\n");
    expect(outputs.join("")).not.toContain("YN0000");
    expect(logs.join("")).toContain("YN0000");
  });

  test("flushes when no source provided", () => {
    const outputs: string[] = [];
    const target = new Writable({
      write(chunk, _enc, cb) {
        outputs.push(chunk.toString());
        cb();
      },
    });
    const logStream = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    const pipe = attachFilteredPipe({ source: null, target, logStream });
    pipe.flush();
    expect(outputs.length).toBe(0);
  });
});

describe("wireStdin", () => {
  test("forwards data into child stdin", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.stdin.on('data', d=>process.stdout.write(d))"],
      {
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const input = new PassThrough();
    wireStdin({ child, stdin: input });

    const received: Promise<string> = new Promise((resolve) => {
      child.stdout?.once("data", (chunk) => resolve(chunk.toString("utf-8")));
    });

    input.write("ping");
    const output = await received;
    expect(output).toBe("ping");

    child.kill("SIGTERM");
  });
});
