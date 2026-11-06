export interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

export interface RootIdentity {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NotebookBindings {
  getMemoryUsage: () => Promise<MemoryUsage>;
  getRootIdentity: () => Promise<RootIdentity>;
}

declare global {
  var bindings: NotebookBindings | undefined;
}
