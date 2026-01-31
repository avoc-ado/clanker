import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { jest } from "@jest/globals";

class FakeServer extends EventEmitter {
  listen(_path: string, cb?: () => void): void {
    cb?.();
  }

  close(cb?: () => void): void {
    cb?.();
  }
}

const createServerMock = jest.fn(() => new FakeServer());

jest.unstable_mockModule("node:net", () => ({
  createServer: createServerMock,
}));

const { startIpcServer } = await import("../ipc/server.js");

const makeSocketPath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "clanker-ipc-default-"));
  return join(root, "ipc.sock");
};

describe("ipc server default net", () => {
  test("starts with default net adapter", async () => {
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        ping: async () => ({ ok: true }),
      },
    });

    expect(createServerMock).toHaveBeenCalledTimes(1);

    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });
});
