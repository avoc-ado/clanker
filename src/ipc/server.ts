import { createServer, type Server } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { makeIpcResponse, type IpcRequest, type IpcResponse } from "./protocol.js";

export interface IpcHandlerContext {
  requestId?: string;
}

export interface IpcHandlers {
  [type: string]: ({
    payload,
    context,
  }: {
    payload: unknown;
    context: IpcHandlerContext;
  }) => Promise<unknown>;
}

export interface IpcServerHandle {
  close: () => Promise<void>;
}

const sendResponse = ({
  socket,
  response,
}: {
  socket: import("node:net").Socket;
  response: IpcResponse;
}): void => {
  socket.write(`${JSON.stringify(response)}\n`);
};

const parseRequest = ({ line }: { line: string }): IpcRequest => {
  const parsed = JSON.parse(line) as IpcRequest;
  if (!parsed || parsed.v !== 1 || typeof parsed.type !== "string") {
    throw new Error("invalid ipc request");
  }
  return parsed;
};

export const startIpcServer = async ({
  socketPath,
  handlers,
  onError,
}: {
  socketPath: string;
  handlers: IpcHandlers;
  onError?: (error: Error) => void;
}): Promise<IpcServerHandle> => {
  await mkdir(dirname(socketPath), { recursive: true });
  await rm(socketPath, { force: true });

  const server: Server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        let request: IpcRequest | null = null;
        try {
          request = parseRequest({ line });
        } catch (error) {
          sendResponse({
            socket,
            response: makeIpcResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          });
          continue;
        }
        const handler = handlers[request.type];
        if (!handler) {
          sendResponse({
            socket,
            response: makeIpcResponse({
              id: request.id,
              ok: false,
              error: `unknown ipc type: ${request.type}`,
            }),
          });
          continue;
        }
        void handler({ payload: request.payload, context: { requestId: request.id } })
          .then((data) => {
            sendResponse({
              socket,
              response: makeIpcResponse({ id: request?.id, ok: true, data }),
            });
          })
          .catch((error) => {
            sendResponse({
              socket,
              response: makeIpcResponse({
                id: request?.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            });
          });
      }
    });
  });

  server.on("error", (error) => {
    if (onError) {
      onError(error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.on("error", reject);
  });

  return {
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await rm(socketPath, { force: true });
    },
  };
};
