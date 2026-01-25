declare module "@jest/globals" {
  export const jest: typeof globalThis.jest & {
    unstable_mockModule: (moduleName: string, factory: () => unknown) => void;
  };
}
