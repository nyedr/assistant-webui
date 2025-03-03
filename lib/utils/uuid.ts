/**
 * Generates a UUID v4 string
 * @returns A new UUID string
 */
export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates a UUID string against the standard UUID v4 format
 * @param uuid The UUID string to validate
 * @throws Error if UUID is invalid
 */
export function validateUUID(uuid: string): void {
  if (!uuid || typeof uuid !== "string") {
    throw new Error("UUID must be a non-empty string");
  }
  if (uuid.length !== 36) {
    throw new Error(`Invalid UUID length: ${uuid.length} characters`);
  }
  // Check format: 8-4-4-4-12 with valid hex digits
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uuid
    )
  ) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }
}
