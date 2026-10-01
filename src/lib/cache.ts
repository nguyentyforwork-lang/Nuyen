/**
 * Small in-process TTL cache with in-flight de-duplication, so that concurrent dashboard
 * requests share one TikTok call. Scope: one Node process. For multi-instance deployments
 * put a shared cache in front (documented in README).
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
  tags: string[];
}

export class TtlCache {
  private entries = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private lastForcedRefresh = new Map<string, number>();

  constructor(
    private ttlMs: number,
    private minRefreshMs: number,
    private now: () => number = Date.now,
  ) {}

  async get<T>(key: string, tags: string[], load: () => Promise<T>, opts: { force?: boolean } = {}): Promise<{ value: T; storedAt: number }> {
    let force = !!opts.force;
    if (force) {
      // Avoid hammering TikTok when "Refresh" is clicked repeatedly.
      const last = this.lastForcedRefresh.get(key);
      if (last !== undefined && this.now() - last < this.minRefreshMs) force = false;
      else this.lastForcedRefresh.set(key, this.now());
    }
    const hit = this.entries.get(key) as Entry<T> | undefined;
    if (!force && hit && hit.expiresAt > this.now()) return { value: hit.value, storedAt: hit.storedAt };

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      const value = await pending;
      return { value, storedAt: (this.entries.get(key) as Entry<T>)?.storedAt ?? this.now() };
    }
    const p = load()
      .then((value) => {
        const storedAt = this.now();
        this.entries.set(key, { value, storedAt, expiresAt: storedAt + this.ttlMs, tags });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    const value = await p;
    return { value, storedAt: (this.entries.get(key) as Entry<T>).storedAt };
  }

  /** Drop every entry tagged with `tag` (e.g. "adv:123" after a write action). */
  invalidate(tag: string) {
    for (const [k, e] of this.entries) if (e.tags.includes(tag)) this.entries.delete(k);
  }

  clear() {
    this.entries.clear();
  }
}
