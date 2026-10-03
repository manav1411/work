/** Remap an acknowledged offline ID through a connected record graph. */
export function remapReference<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") {
    if (value === from) return to as T;
    return value
      .replaceAll(
        `record=${encodeURIComponent(from)}`,
        `record=${encodeURIComponent(to)}`,
      )
      .replaceAll(
        `action=${encodeURIComponent(from)}`,
        `action=${encodeURIComponent(to)}`,
      ) as T;
  }
  if (Array.isArray(value))
    return value.map((item) => remapReference(item, from, to)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        remapReference(item, from, to),
      ]),
    ) as T;
  return value;
}
