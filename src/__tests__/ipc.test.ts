import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { jest } from "@jest/globals";
import { sendIpcRequest } from "../ipc/client.js";
import { startIpcServer } from "../ipc/server.js";
import { makeIpcResponse } from "../ipc/protocol.js";
import { IPC_DOWN_CACHE_MS } from "../constants.js";

const makeSocketPath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "clanker-ipc-"));
  return join(root, "ipc.sock");
};

interface FakeSocket extends EventEmitter {
  peer?: FakeSocket;
  write: (data: string) => void;
  end: () => void;
  destroy: () => void;
}

interface FakeServer extends EventEmitter {
  listen: (path: string, cb?: () => void) => void;
  close: (cb?: () => void) => void;
}

const makeFakeSocket = (): FakeSocket => {
  const socket = new EventEmitter() as FakeSocket;
  socket.write = (data: string) => {
    socket.peer?.emit("data", Buffer.from(data));
  };
  socket.end = () => {
    socket.emit("end");
  };
  socket.destroy = () => {
    socket.emit("close");
  };
  return socket;
};

const makeNetStub = (): {
  createServer: (onConnection: (socket: FakeSocket) => void) => FakeServer;
  createConnection: (path: string) => FakeSocket;
} => {
  const servers = new Map<
    string,
    { onConnection: (socket: FakeSocket) => void; server: FakeServer }
  >();

  const createServer = (onConnection: (socket: FakeSocket) => void): FakeServer => {
    const server = new EventEmitter() as FakeServer;
    server.listen = (path: string, cb?: () => void) => {
      servers.set(path, { onConnection, server });
      cb?.();
    };
    server.close = (cb?: () => void) => {
      cb?.();
    };
    return server;
  };

  const createConnection = (path: string): FakeSocket => {
    const entry = servers.get(path);
    const client = makeFakeSocket();
    const serverSide = makeFakeSocket();
    client.peer = serverSide;
    serverSide.peer = client;
    if (!entry) {
      queueMicrotask(() => {
        client.emit("error", new Error("ipc socket missing"));
      });
      return client;
    }
    queueMicrotask(() => {
      entry.onConnection(serverSide);
      client.emit("connect");
    });
    return client;
  };

  return { createServer, createConnection };
};

describe("ipc", () => {
  test("handles request/response", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        echo: async ({ payload }) => payload,
      },
      net,
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "echo",
      payload: { ok: true },
      connect: net.createConnection,
    });
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ ok: true });
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client ignores blank lines", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        const line = chunk.toString().trim();
        const request = JSON.parse(line) as { id?: string };
        socket.write("\n");
        socket.write(`${JSON.stringify(makeIpcResponse({ id: request.id, ok: true }))}\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, resolve);
      server.on("error", reject);
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "echo",
      payload: {},
      connect: net.createConnection,
    });
    expect(response.ok).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("returns error for unknown type", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {},
      net,
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "nope",
      payload: {},
      connect: net.createConnection,
    });
    expect(response.ok).toBe(false);
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("handles handler error", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        fail: async () => {
          throw new Error("boom");
        },
      },
      net,
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "fail",
      payload: {},
      connect: net.createConnection,
    });
    expect(response.ok).toBe(false);
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("handles non-Error handler rejection", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        fail: async () => {
          throw "boom";
        },
      },
      net,
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "fail",
      payload: {},
      connect: net.createConnection,
    });
    expect(response.ok).toBe(false);
    expect(response.error).toContain("boom");
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client handles invalid json response", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = net.createServer((socket) => {
      socket.on("data", () => {
        socket.write("bad-json\n");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, resolve);
      server.on("error", reject);
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "echo",
      payload: {},
      connect: net.createConnection,
    });
    expect(response.ok).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client ignores extra data after settling", async () => {
    const socketPath = await makeSocketPath();
    await writeFile(socketPath, "");
    const socket = new EventEmitter() as FakeSocket;
    socket.write = () => {
      const response = JSON.stringify(makeIpcResponse({ ok: true }));
      socket.emit("data", Buffer.from(`${response}\n`));
      socket.emit("data", Buffer.from(`${response}\n`));
      socket.emit("error", new Error("late"));
    };
    socket.end = jest.fn();
    socket.destroy = jest.fn();
    const connect = () => {
      queueMicrotask(() => {
        socket.emit("connect");
      });
      return socket;
    };

    const response = await sendIpcRequest({
      socketPath,
      type: "echo",
      payload: {},
      connect,
      id: "req-1",
      timeoutMs: 250,
    });
    expect(response.ok).toBe(true);
    expect(socket.end).toHaveBeenCalled();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client ignores mismatched ids", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        const line = chunk.toString().trim();
        const request = JSON.parse(line) as { id?: string };
        socket.write(`${JSON.stringify(makeIpcResponse({ id: "wrong", ok: true }))}\n`);
        socket.write(`${JSON.stringify(makeIpcResponse({ id: request.id, ok: true }))}\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, resolve);
      server.on("error", reject);
    });
    await writeFile(socketPath, "");
    const response = await sendIpcRequest({
      socketPath,
      type: "echo",
      payload: {},
      connect: net.createConnection,
    });
    expect(response.ok).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client marks socket down after timeout", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = net.createServer((socket) => {
      socket.on("data", () => {
        // keep connection open without responding
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, resolve);
      server.on("error", reject);
    });
    await writeFile(socketPath, "");
    await expect(
      sendIpcRequest({
        socketPath,
        type: "echo",
        payload: {},
        timeoutMs: 10,
        connect: net.createConnection,
      }),
    ).rejects.toThrow("ipc timeout");
    await expect(
      sendIpcRequest({
        socketPath,
        type: "echo",
        payload: {},
        timeoutMs: 10,
        connect: net.createConnection,
      }),
    ).rejects.toThrow("ipc socket unavailable");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client rejects missing socket", async () => {
    const socketPath = join(tmpdir(), "missing.sock");
    await expect(
      sendIpcRequest({
        socketPath,
        type: "echo",
        payload: {},
        timeoutMs: 250,
      }),
    ).rejects.toThrow("ipc socket missing");
    await expect(
      sendIpcRequest({
        socketPath,
        type: "echo",
        payload: {},
        timeoutMs: 250,
      }),
    ).rejects.toThrow("ipc socket unavailable");
  });

  test("client rechecks socket after down cache expires", async () => {
    jest.useFakeTimers();
    try {
      const now = new Date("2024-01-01T00:00:00Z");
      jest.setSystemTime(now);
      const socketPath = join(tmpdir(), `missing-${randomUUID()}.sock`);
      await expect(
        sendIpcRequest({
          socketPath,
          type: "echo",
          payload: {},
          timeoutMs: 250,
        }),
      ).rejects.toThrow("ipc socket missing");
      jest.setSystemTime(new Date(now.getTime() + IPC_DOWN_CACHE_MS + 1));
      await expect(
        sendIpcRequest({
          socketPath,
          type: "echo",
          payload: {},
          timeoutMs: 250,
        }),
      ).rejects.toThrow("ipc socket missing");
    } finally {
      jest.useRealTimers();
    }
  });

  test("server ignores blank lines before requests", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        echo: async ({ payload }) => payload,
      },
      net,
    });
    await writeFile(socketPath, "");
    const response = await new Promise<string>((resolve) => {
      const socket = net.createConnection(socketPath);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes("\n")) {
          const line = buffer.split("\n").find((entry) => entry.trim());
          if (line) {
            resolve(line);
            socket.end();
          }
        }
      });
      socket.on("connect", () => {
        socket.write("\n");
        socket.write(
          `${JSON.stringify({
            v: 1,
            id: "1",
            type: "echo",
            payload: { ok: true },
          })}\n`,
        );
      });
    });
    const parsed = JSON.parse(response) as { ok?: boolean; data?: { ok?: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ ok: true });
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("server handles invalid request", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        echo: async () => ({ ok: true }),
      },
      net,
    });
    await writeFile(socketPath, "");
    const response = await new Promise<string>((resolve) => {
      const socket = net.createConnection(socketPath);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes("\n")) {
          resolve(buffer.trim());
          socket.end();
        }
      });
      socket.on("connect", () => {
        socket.write(JSON.stringify({ v: 2, type: "echo" }) + "\n");
      });
    });
    const parsed = JSON.parse(response) as { ok?: boolean };
    expect(parsed.ok).toBe(false);
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("server starts with default net adapter", async () => {
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        ping: async () => ({ ok: true }),
      },
    });
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("server forwards errors to onError", async () => {
    const socketPath = await makeSocketPath();
    const serverEmitter = new EventEmitter() as FakeServer;
    serverEmitter.listen = (_path: string, cb?: () => void) => {
      cb?.();
    };
    serverEmitter.close = (cb?: () => void) => {
      cb?.();
    };
    const net = {
      createServer: () => serverEmitter,
    };
    const onError = jest.fn();
    const handle = await startIpcServer({
      socketPath,
      handlers: {},
      onError,
      net,
    });
    const error = new Error("boom");
    serverEmitter.emit("error", error);
    expect(onError).toHaveBeenCalledWith(error);
    await handle.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("server rejects unknown request types", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {},
      net,
    });
    await writeFile(socketPath, "");
    const response = await new Promise<string>((resolve) => {
      const socket = net.createConnection(socketPath);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes("\n")) {
          resolve(buffer.trim());
          socket.end();
        }
      });
      socket.on("connect", () => {
        socket.write("\n");
        socket.write(JSON.stringify({ v: 1, id: "req-1", type: "missing" }) + "\n");
      });
    });
    const parsed = JSON.parse(response) as { ok?: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("unknown ipc type");
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("server serializes handler errors", async () => {
    const net = makeNetStub();
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        boom: async () => {
          throw "boom";
        },
      },
      net,
    });
    await writeFile(socketPath, "");
    const response = await new Promise<string>((resolve) => {
      const socket = net.createConnection(socketPath);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes("\n")) {
          resolve(buffer.trim());
          socket.end();
        }
      });
      socket.on("connect", () => {
        socket.write(JSON.stringify({ v: 1, id: "req-2", type: "boom" }) + "\n");
      });
    });
    const parsed = JSON.parse(response) as { ok?: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("boom");
    await server.close();
    await rm(dirname(socketPath), { recursive: true, force: true });
  });
  test("makeIpcResponse creates expected shape", () => {
    const response = makeIpcResponse({ id: "1", ok: true, data: { ok: true } });
    expect(response).toEqual({ v: 1, id: "1", ok: true, data: { ok: true }, error: undefined });
  });
});
