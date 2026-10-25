import { describe, expect, it, vi } from 'vitest'
vi.mock('@/api/groupRetention', () => ({ fetchGroupRetentionStates: vi.fn() }))
import { GroupRetentionSync, retentionSeq } from '@/utils/groupRetention'
import type { GroupRetentionState } from '@/api/groupRetention'

const a = 'sg_11111111111141118111111111111111'
const b = 'sg_22222222222242228222222222222222'
const row = (minVisibleSeq = 100, revision = 1, conversationId = a): GroupRetentionState => ({
  conversationId, minVisibleSeq, revision, updatedAt: '2026-10-18T06:00:00Z',
})
function fixture() {
  const disk = new Map<string, unknown>()
  const fetch = vi.fn(async (_ids: string[]) => ({ items: [row()] }))
  const options = { read: (key: string) => disk.get(key), write: (key: string, value: unknown) => { disk.set(key, value) }, fetch }
  const sync = new GroupRetentionSync(options)
  sync.setOwner('owner-a')
  return { sync, disk, fetch, options }
}

describe('durable group retention synchronization (H5 and native)', () => {
  it('uses authoritative seq only and never mutates frozen PascalCase native objects', async () => {
    const { sync } = fixture(); await sync.sync([a])
    const old = Object.freeze({ Seq: '99', ContentType: 102 })
    const keep = Object.freeze({ seq: 100, contentType: 102 })
    const pending = Object.freeze({ Seq: 0, SendTime: 1 })
    expect(sync.filter(a, [old, keep, pending])).toEqual([keep, pending])
    expect(sync.removed('si_a_b', old)).toBe(false)
    expect(sync.removed(b, old)).toBe(false)
    expect(old).toEqual({ Seq: '99', ContentType: 102 })
    expect(retentionSeq({ Seq: '9007199254740992' })).toBe(0)
    expect(retentionSeq({ seq: 99.2 })).toBe(0)
    expect(retentionSeq({ seq: 0, Seq: '100' })).toBe(100)
  })
  it('survives page lifetime and process restart, no auth token in storage key', async () => {
    const f = fixture(); await f.sync.sync([a])
    const restarted = new GroupRetentionSync(f.options); restarted.setOwner('owner-a')
    expect(restarted.removed(a, { seq: 1 })).toBe(true)
    expect([...f.disk.keys()]).toEqual(['im:group-retention:v1:owner-a'])
    restarted.setOwner('owner-b')
    expect(restarted.minSeq(a)).toBe(0)
    restarted.setOwner('owner-a')
    expect(restarted.minSeq(a)).toBe(100)
  })
  it('does not regress after empty, stale, rolled-back or failed responses', async () => {
    const { sync, fetch } = fixture(); await sync.sync([a])
    for (const items of [[], [row(20, 2)], [row(200, 1)], [row(200, 0)]]) {
      fetch.mockResolvedValueOnce({ items }); await sync.sync([a], true)
      expect(sync.minSeq(a)).toBe(100)
    }
    fetch.mockRejectedValueOnce(new Error('offline')); await sync.sync([a], true)
    expect(sync.minSeq(a)).toBe(100)
    fetch.mockResolvedValueOnce({ items: [row(200, 2)] }); await sync.sync([a], true)
    expect(sync.minSeq(a)).toBe(200)
  })
  it('rejects duplicate, foreign or corrupt server states atomically', async () => {
    const { sync, fetch } = fixture()
    for (const items of [[row(100, 1, b)], [row(), row()], [row(1.1)], [row(2 ** 53)], [{ ...row(), updatedAt: 'bad' }]]) {
      fetch.mockResolvedValueOnce({ items }); await sync.sync([a], true)
      expect(sync.minSeq(a)).toBe(0)
    }
  })
  it('fences requests crossing logout/account switch and coalesces same batch', async () => {
    const { sync, fetch, disk } = fixture()
    let finish!: (value: { items: GroupRetentionState[] }) => void
    fetch.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    const x = sync.sync([a]); const y = sync.sync([a])
    expect(fetch).toHaveBeenCalledTimes(1)
    sync.setOwner('owner-b'); finish({ items: [row()] }); await Promise.all([x, y])
    expect(sync.minSeq(a)).toBe(0); expect(disk.size).toBe(0)
  })
  it('refreshes notifications exactly when a boundary advances, unsubscribes cleanly', async () => {
    const { sync, fetch } = fixture(); const listener = vi.fn(); const off = sync.subscribe(listener)
    await sync.sync([a]); await sync.sync([a])
    expect(fetch).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledWith([a])
    off(); fetch.mockResolvedValueOnce({ items: [row(200, 2)] }); await sync.sync([a], true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('supports bounded 50-group batches and does not request private chats', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => ({ items: [] }))
    const ids = Array.from({ length: 101 }, (_, i) => `sg_${i.toString(16).padStart(32, '0')}`)
    await f.sync.sync([...ids, ids[0], 'si_a_b'])
    expect(f.fetch.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 1])
  })
  it('keeps memory protection when persistent storage is full', async () => {
    const f = fixture(); f.options.write = () => { throw new Error('quota') }
    const sync = new GroupRetentionSync(f.options); sync.setOwner('owner')
    await sync.sync([a]); expect(sync.removed(a, { seq: 20 })).toBe(true)
  })

  it('never silently evicts old group tombstones after 5000 groups or restart', async () => {
    const f = fixture()
    const items = Array.from({ length: 5001 }, (_, i) => row(100, 1, `sg_${i.toString(16).padStart(32, '0')}`))
    f.disk.set('im:group-retention:v1:owner-large', items)
    f.sync.setOwner('owner-large')
    expect(f.sync.removed(items[0].conversationId, { Seq: '99' })).toBe(true)
    f.fetch.mockResolvedValueOnce({ items: [row()] })
    await f.sync.sync([a])
    const restarted = new GroupRetentionSync(f.options); restarted.setOwner('owner-large')
    expect(restarted.removed(items[0].conversationId, { seq: 99 })).toBe(true)
    expect(restarted.minSeq(a)).toBe(100)
    expect(f.disk.get('im:group-retention:v1:owner-large')).toHaveLength(5002)
  })

  it('removes only expired unread prefixes without marking retained messages as read', async () => {
    const { sync } = fixture(); await sync.sync([a])
    expect(sync.unread(a, Object.freeze({ Seq: '105' }), 105)).toBe(6)
    expect(sync.unread(a, { seq: 105 }, 3)).toBe(3)
    expect(sync.unread(a, { seq: 99 }, 99)).toBe(0)
    expect(sync.unread(a, { seq: 0 }, 20)).toBe(20)
    expect(sync.unread('si_a_b', { seq: 10 }, 10)).toBe(10)
  })
})
