import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { makeIpcResponse, type IpcRequest, type IpcResponse } from "./protocol.js";
import { IPC_DOWN_CACHE_MS, IPC_TIMEOUT_MS } from "../constants.js";

const downCache = new Map<string, number>();

const isSocketDown = ({ socketPath }: { socketPath: string }): boolean => {
  const retryAt = downCache.get(socketPath);
  if (!retryAt) {
    return false;
  }
  if (Date.now() < retryAt) {
    return true;
  }
  downCache.delete(socketPath);
  return false;
};

const markSocketDown = ({ socketPath }: { socketPath: string }): void => {
  downCache.set(socketPath, Date.now() + IPC_DOWN_CACHE_MS);
};

interface IpcClientSocket {
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "connect", listener: () => void): void;
  write: (data: string) => void;
  end: () => void;
  destroy: () => void;
}

type IpcConnect = (path: string) => IpcClientSocket;

export const sendIpcRequest = async ({
  socketPath,
  type,
  payload,
  id,
  timeoutMs,
  connect,
}: {
  socketPath: string;
  type: string;
  payload?: unknown;
  id?: string;
  timeoutMs?: number;
  connect?: IpcConnect;
}): Promise<IpcResponse> => {
  if (isSocketDown({ socketPath })) {
    throw new Error("ipc socket unavailable");
  }
  try {
    await stat(socketPath);
  } catch {
    markSocketDown({ socketPath });
    throw new Error("ipc socket missing");
  }
  const requestId = id ?? randomUUID();
  const message: IpcRequest = { v: 1, id: requestId, type, payload };
  const timeout = timeoutMs ?? IPC_TIMEOUT_MS;
  const connectFn = connect ?? createConnection;

  return new Promise<IpcResponse>((resolve, reject) => {
    const socket = connectFn(socketPath);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      markSocketDown({ socketPath });
      reject(new Error(`ipc timeout (${timeout}ms)`));
    }, timeout);

    const finalize = (response: IpcResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(response);
    };

    socket.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      markSocketDown({ socketPath });
      reject(error);
    });

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as IpcResponse;
          if (parsed?.id && parsed.id !== requestId) {
            continue;
          }
          finalize(parsed);
          return;
        } catch (error) {
          finalize(
            makeIpcResponse({
              id: requestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return;
        }
      }
    });
  });
};
