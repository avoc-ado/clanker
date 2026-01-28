import { spawn } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import {
  attachFilteredPipe,
  shouldSuppressYarnInstallLine,
  wireStdin,
} from "../codex/process-io.js";

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

  test("flushes buffered yarn install line on end without forwarding", async () => {
    const source = new PassThrough();
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
    attachFilteredPipe({ source, target, logStream });

    source.end("yarn install");
    await new Promise((resolve) => source.on("end", resolve));

    expect(outputs.length).toBe(0);
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

  test("calls onLine for each output line", async () => {
    const source = new PassThrough();
    const lines: string[] = [];
    const target = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    const logStream = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    attachFilteredPipe({
      source,
      target,
      logStream,
      onLine: (line) => {
        lines.push(line);
      },
    });

    source.write("yarn install\n");
    source.end("hello");
    await new Promise((resolve) => source.on("end", resolve));

    expect(lines).toContain("yarn install");
    expect(lines).toContain("hello");
  });
});

describe("shouldSuppressYarnInstallLine", () => {
  test("returns false for blank lines", () => {
    expect(shouldSuppressYarnInstallLine({ line: "   " })).toBe(false);
  });

  test("returns true for yarn install output", () => {
    expect(shouldSuppressYarnInstallLine({ line: "yarn install --frozen-lockfile" })).toBe(true);
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

  test("returns early when child stdin missing", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 50)"], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    wireStdin({ child });

    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  });

  test("wires to process.stdin by default and cleans up on exit", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 50)"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const before = process.stdin.listenerCount("data");

    wireStdin({ child });
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    process.stdin.pause();

    const after = process.stdin.listenerCount("data");
    expect(after).toBe(before);
  });
});
