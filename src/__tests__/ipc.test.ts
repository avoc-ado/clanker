import { createConnection, createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sendIpcRequest } from "../ipc/client.js";
import { startIpcServer } from "../ipc/server.js";
import { makeIpcResponse } from "../ipc/protocol.js";

const makeSocketPath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "clanker-ipc-"));
  return join(root, "ipc.sock");
};

describe("ipc", () => {
  test("handles request/response", async () => {
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        echo: async ({ payload }) => payload,
      },
    });
    const response = await sendIpcRequest({
      socketPath,
      type: "echo",
      payload: { ok: true },
    });
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ ok: true });
    await server.close();
  });

  test("client ignores blank lines", async () => {
    const socketPath = await makeSocketPath();
    const server = createServer((socket) => {
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
    const response = await sendIpcRequest({ socketPath, type: "echo", payload: {} });
    expect(response.ok).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("returns error for unknown type", async () => {
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {},
    });
    const response = await sendIpcRequest({ socketPath, type: "nope", payload: {} });
    expect(response.ok).toBe(false);
    await server.close();
  });

  test("handles handler error", async () => {
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        fail: async () => {
          throw new Error("boom");
        },
      },
    });
    const response = await sendIpcRequest({ socketPath, type: "fail", payload: {} });
    expect(response.ok).toBe(false);
    await server.close();
  });

  test("client handles invalid json response", async () => {
    const socketPath = await makeSocketPath();
    const server = createServer((socket) => {
      socket.on("data", () => {
        socket.write("bad-json\n");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, resolve);
      server.on("error", reject);
    });
    const response = await sendIpcRequest({ socketPath, type: "echo", payload: {} });
    expect(response.ok).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client ignores mismatched ids", async () => {
    const socketPath = await makeSocketPath();
    const server = createServer((socket) => {
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
    const response = await sendIpcRequest({ socketPath, type: "echo", payload: {} });
    expect(response.ok).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dirname(socketPath), { recursive: true, force: true });
  });

  test("client rejects missing socket", async () => {
    await expect(
      sendIpcRequest({
        socketPath: join(tmpdir(), "missing.sock"),
        type: "echo",
        payload: {},
        timeoutMs: 250,
      }),
    ).rejects.toThrow();
  });

  test("server handles invalid request", async () => {
    const socketPath = await makeSocketPath();
    const server = await startIpcServer({
      socketPath,
      handlers: {
        echo: async () => ({ ok: true }),
      },
    });
    const response = await new Promise<string>((resolve) => {
      const socket = createConnection(socketPath);
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
  });

  test("makeIpcResponse creates expected shape", () => {
    const response = makeIpcResponse({ id: "1", ok: true, data: { ok: true } });
    expect(response).toEqual({ v: 1, id: "1", ok: true, data: { ok: true }, error: undefined });
  });
});
