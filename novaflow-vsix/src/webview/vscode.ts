/**
 * Acquires the VS Code webview API so the webview can postMessage to the extension host.
 * This is a singleton — acquireVsCodeApi() can only be called once per webview lifetime.
 */
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscodeApi = (globalThis as any).acquireVsCodeApi?.() as
  | ReturnType<typeof acquireVsCodeApi>
  | undefined;

export function postMessage(msg: unknown): void {
  vscodeApi?.postMessage(msg);
}
