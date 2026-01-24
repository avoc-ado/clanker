import type { ChildProcess } from "node:child_process";

const YARN_LOG_LINE_REGEX = /^(?:\s*➤\s*)?YN\d{4}:/;
const YARN_INSTALL_LINE_REGEX = /\byarn install\b/i;

export const shouldSuppressYarnInstallLine = ({ line }: { line: string }): boolean => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return YARN_LOG_LINE_REGEX.test(trimmed) || YARN_INSTALL_LINE_REGEX.test(trimmed);
};

export const attachFilteredPipe = ({
  source,
  target,
  logStream,
}: {
  source: NodeJS.ReadableStream | null | undefined;
  target: NodeJS.WritableStream;
  logStream: NodeJS.WritableStream;
}): { flush: () => void } => {
  let buffer = "";
  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    const pending = buffer;
    buffer = "";
    if (!shouldSuppressYarnInstallLine({ line: pending })) {
      target.write(pending);
    }
  };
  if (!source) {
    return { flush };
  }
  source.on("data", (chunk) => {
    const text = buffer + chunk.toString("utf-8");
    const lines = text.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const hasCarriageReturn = line.endsWith("\r");
      const outputLine = hasCarriageReturn ? line.slice(0, -1) : line;
      const newline = hasCarriageReturn ? "\r\n" : "\n";
      if (!shouldSuppressYarnInstallLine({ line: outputLine })) {
        target.write(outputLine + newline);
      }
    }
    logStream.write(chunk);
  });
  source.on("end", () => {
    flush();
  });
  return { flush };
};

export const wireStdin = ({
  child,
  stdin,
}: {
  child: ChildProcess;
  stdin?: NodeJS.ReadableStream;
}): void => {
  if (!child.stdin) {
    return;
  }
  const input = stdin ?? process.stdin;
  const handleData = (chunk: Buffer): void => {
    if (child.stdin?.writable) {
      child.stdin.write(chunk);
    }
  };
  input.on("data", handleData);
  if (input === process.stdin) {
    process.stdin.resume();
  }
  const cleanup = (): void => {
    input.off("data", handleData);
  };
  child.on("exit", cleanup);
  child.on("close", cleanup);
};
