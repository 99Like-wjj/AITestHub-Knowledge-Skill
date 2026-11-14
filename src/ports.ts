/** Structural ABI v0.1.0, aligned with AITestHub tooling/local-client/src/ports.ts. */
export interface ToolPort {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export interface ResultPort {
  read(raw: unknown): unknown;
  assertSafe(value: unknown): void;
}
export interface WorkspacePort {
  readText(key: string): Promise<string | null>;
  writeTextAtomic(key: string, text: string): Promise<void>;
  withExclusive<T>(key: string, work: () => Promise<T>): Promise<T>;
}
export interface FileDigest {
  bytes: string;
  sha256: string;
}
export interface FileChannelPort {
  downloadToFile(input: {
    projectId: string;
    sourcePath: string;
    destinationPath: string;
    expected?: FileDigest;
  }): Promise<
    FileDigest & {
      absolutePath: string;
      expectedIntegrityMatched: boolean | null;
    }
  >;
}
