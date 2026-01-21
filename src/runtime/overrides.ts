export interface RuntimeOverrides {
  codexCommand?: string;
  codexTty?: boolean;
  disableCodex?: boolean;
  promptFile?: string;
}

let runtimeOverrides: RuntimeOverrides = {};

export const setRuntimeOverrides = ({ overrides }: { overrides: RuntimeOverrides }): void => {
  runtimeOverrides = overrides;
};

export const getRuntimeOverrides = (): RuntimeOverrides => runtimeOverrides;
