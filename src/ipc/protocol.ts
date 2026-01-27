export interface IpcRequest {
  v: 1;
  id?: string;
  type: string;
  payload?: unknown;
}

export interface IpcResponse {
  v: 1;
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export const makeIpcResponse = ({
  id,
  ok,
  data,
  error,
}: {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}): IpcResponse => ({
  v: 1,
  id,
  ok,
  data,
  error,
});
