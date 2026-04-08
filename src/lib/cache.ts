/**
 * Simple in-memory cache for API route responses.
 * Keys expire after CACHE_TTL seconds (default 300s / 5 min).
 * Survives within a single Next.js server process — clears on deploy/restart.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const TTL_MS = parseInt(process.env.CACHE_TTL ?? "300", 10) * 1000;

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.data;
}

export function cacheSet<T>(key: string, data: T, ttlMs = TTL_MS): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(pattern: string): void {
  for (const key of store.keys()) {
    if (key.includes(pattern)) store.delete(key);
  }
}

/** Wrap an async function with cache-aside logic */
export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = TTL_MS
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return cached;
  const data = await fn();
  cacheSet(key, data, ttlMs);
  return data;
}
