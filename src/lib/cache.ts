import "server-only";

type Entry = { value: unknown; expires: number };

// Survives dev hot-reload by living on globalThis.
const store: Map<string, Entry> = ((globalThis as Record<string, unknown>).__sheetCache ??=
  new Map<string, Entry>()) as Map<string, Entry>;

const inflight: Map<string, Promise<unknown>> = ((globalThis as Record<string, unknown>).__sheetInflight ??=
  new Map()) as Map<string, Promise<unknown>>;

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Invalidate every cache entry whose key starts with one of the prefixes. */
export function invalidate(...prefixes: string[]) {
  for (const key of store.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) store.delete(key);
  }
}
