import { fetchGroupRetentionStates, type GroupRetentionState } from '@/api/groupRetention'

/** A visibility tombstone is durable app state, not disposable image cache. */
export function isRetentionStorageKey(key: string): boolean {
  return /^im:group-retention:v1:[a-zA-Z0-9_-]{1,96}$/.test(key)
}

export function isRetentionGroup(id: string): boolean {
  return /^sg_[0-9a-f]{32}$/.test(id)
}

function positiveSafeInteger(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 0
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

/** No mutation of SDK/native objects; iOS may hand us frozen PascalCase data. */
export function retentionSeq(item: unknown): number {
  if (!item || typeof item !== 'object') return 0
  const raw = item as Record<string, unknown>
  return positiveSafeInteger(raw.seq) || positiveSafeInteger(raw.Seq)
}

function validState(raw: unknown): raw is GroupRetentionState {
  if (!raw || typeof raw !== 'object') return false
  const row = raw as GroupRetentionState
  return isRetentionGroup(row.conversationId) && positiveSafeInteger(row.minVisibleSeq) === row.minVisibleSeq &&
    positiveSafeInteger(row.revision) === row.revision && typeof row.updatedAt === 'string' &&
    Number.isFinite(Date.parse(row.updatedAt))
}

interface Dependencies {
  read(key: string): unknown
  write(key: string, value: unknown): void
  fetch(ids: string[]): Promise<{ items: GroupRetentionState[] }>
  now?: () => number
}

/** Small per-owner durable tombstones, independent of page lifetime/SDK cache.
 * Missing rows, network errors and old responses must never resurrect history.
 * These bounds affect chat history only, NOT independent favorites/quotes.
 */
export class GroupRetentionSync {
  private owner = ''
  private generation = 0
  private states = new Map<string, GroupRetentionState>()
  private fetchedAt = new Map<string, number>()
  private pending = new Map<string, Promise<void>>()
  private listeners = new Set<(ids: string[]) => void>()
  private now: () => number

  constructor(private deps: Dependencies) { this.now = deps.now || Date.now }

  setOwner(owner: string) {
    if (owner === this.owner) return
    this.owner = /^[a-zA-Z0-9_-]{1,96}$/.test(owner) ? owner : ''
    this.generation++
    this.states.clear()
    this.fetchedAt.clear()
    this.pending.clear()
    if (!this.owner) return
    try {
      const raw = this.deps.read(this.key())
      if (Array.isArray(raw)) {
        for (const row of raw) if (validState(row)) this.merge(row)
      }
    } catch { /* Server sync can rebuild a removed/corrupt storage index. */ }
  }

  private key() { return `im:group-retention:v1:${this.owner}` }

  private merge(row: GroupRetentionState): boolean {
    const prev = this.states.get(row.conversationId)
    if (prev && (row.revision <= prev.revision || row.minVisibleSeq < prev.minVisibleSeq)) return false
    this.states.set(row.conversationId, { ...row })
    return !prev || row.minVisibleSeq > prev.minVisibleSeq
  }

  minSeq(id: string): number { return this.states.get(id)?.minVisibleSeq || 0 }

  /** Native SDK unread counts may lag a new server boundary until reconnect.
   * Cap only the expired prefix; never mark any retained message as read.
   * Unknown/local seqs keep the SDK count instead of guessing a timestamp.
   */
  unread(id: string, latest: unknown, count: number): number {
    const minSeq = this.minSeq(id)
    const seq = retentionSeq(latest)
    if (!isRetentionGroup(id) || !minSeq || !seq) return count
    return Math.min(count, Math.max(0, seq - minSeq + 1))
  }

  removed(id: string, item: unknown): boolean {
    const seq = retentionSeq(item)
    // seq=0 is an uncommitted local/native send, not an old message.
    return isRetentionGroup(id) && seq > 0 && seq < this.minSeq(id)
  }

  filter<T>(id: string, items: T[]): T[] { return items.filter((item) => !this.removed(id, item)) }

  subscribe(listener: (ids: string[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async sync(ids: string[], force = false): Promise<void> {
    if (!this.owner) return
    const generation = this.generation
    const wanted = [...new Set(ids.filter(isRetentionGroup))]
      .filter((id) => force || !this.fetchedAt.has(id) || this.now() - this.fetchedAt.get(id)! >= 15_000).sort()
    for (let i = 0; i < wanted.length && generation === this.generation; i += 50) await this.batch(wanted.slice(i, i + 50))
  }

  private batch(ids: string[]): Promise<void> {
    const key = ids.join(',')
    const existing = this.pending.get(key)
    if (existing) return existing
    const generation = this.generation
    const task = (async () => {
      try {
        const result = await this.deps.fetch(ids)
        if (generation !== this.generation) return
        if (!Array.isArray(result?.items) || result.items.length > ids.length) return
        const requested = new Set(ids)
        const seen = new Set<string>()
        // Reject the whole response before committing any partial/foreign state.
        for (const row of result.items) {
          if (!validState(row) || !requested.has(row.conversationId) || seen.has(row.conversationId)) return
          seen.add(row.conversationId)
        }
        const changed: string[] = []
        let accepted = false
        for (const row of result.items) {
          const prev = this.states.get(row.conversationId)
          if (this.merge(row)) changed.push(row.conversationId)
          accepted ||= prev !== this.states.get(row.conversationId)
        }
        ids.forEach((id) => this.fetchedAt.set(id, this.now()))
        if (accepted) {
          // Never evict old tombstones by an LRU/count cap: rejoining an older
          // group while offline must not resurrect its expired SDK history.
          try { this.deps.write(this.key(), [...this.states.values()]) } catch { /* Memory filter still applies. */ }
        }
        if (changed.length) {
          this.listeners.forEach((listener) => listener(changed))
        }
      } catch { /* Offline: retain existing tombstones, never replace with []. */ }
    })().finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) })
    this.pending.set(key, task)
    return task
  }
}

export const groupRetention = new GroupRetentionSync({
  read: (key) => uni.getStorageSync(key),
  write: (key, value) => uni.setStorageSync(key, value),
  fetch: fetchGroupRetentionStates,
})
