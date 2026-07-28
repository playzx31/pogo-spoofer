import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

/** True when running inside the Tauri shell (vs. plain `vite dev` in a browser tab). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Wraps `invoke` so the frontend never crashes when it isn't running inside
 * Tauri (useful for quick browser-only UI iteration) or when the backend
 * command itself fails. Errors are logged, never thrown further up into
 * component code that doesn't expect it for best-effort calls like history
 * logging.
 */
export async function safeInvoke<T>(command: string, args?: InvokeArgs): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[tauri] command "${command}" failed:`, error);
    return undefined;
  }
}
