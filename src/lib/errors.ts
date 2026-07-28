export interface FriendlyError {
  message: string;
  suggestedAction?: string;
}

/**
 * Normalizes a thrown value into `{ message, suggestedAction }`. Tauri v2
 * rejects a command's promise with the command's serialized `Err` payload
 * as-is (not wrapped in a JS `Error`), so a failed `set_location`/device
 * command surfaces here as a plain `{ message, suggestedAction }` object;
 * anything else (a real JS `Error`, a string) is coerced to the same shape.
 */
export function toFriendlyError(error: unknown): FriendlyError {
  if (error && typeof error === "object" && "message" in error) {
    const e = error as { message: unknown; suggestedAction?: unknown };
    return {
      message: String(e.message),
      suggestedAction: typeof e.suggestedAction === "string" ? e.suggestedAction : undefined,
    };
  }
  return { message: String(error) };
}
