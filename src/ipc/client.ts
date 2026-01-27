import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { makeIpcResponse, type IpcRequest, type IpcResponse } from "./protocol.js";

const DEFAULT_TIMEOUT_MS = 5000;

export const sendIpcRequest = async ({
  socketPath,
  type,
  payload,
  id,
  timeoutMs,
}: {
  socketPath: string;
  type: string;
  payload?: unknown;
  id?: string;
  timeoutMs?: number;
}): Promise<IpcResponse> => {
  const requestId = id ?? randomUUID();
  const message: IpcRequest = { v: 1, id: requestId, type, payload };
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<IpcResponse>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
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
