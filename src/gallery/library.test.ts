import { describe, expect, it } from 'vitest'
import type { CanvasRecord, CanvasStroke } from './recording'
import {
  canDeleteArtwork,
  collectStoredArtworks,
  countStrokeSegments,
  createArtworkStorageKey,
  getPlaybackDurationMs,
  getCycledArtworkKey,
  sliceStrokesForPlayback,
  sortStrokesForPlayback,
} from './library'

const record = (savedAt: string, userId = 'user-a'): CanvasRecord => ({
  version: 1,
  slotId: 1,
  title: '作品',
  author: { userId, displayName: '作者' },
  savedAt,
  sourceSyncId: 'gallery-dcpen',
  strokes: [
    {
      sid: `${userId}:2:mabc123:7`,
      color: '#ff0000',
      pts: [0, 0, 0, 0.1, 0, 0, 0.2, 0, 0],
      hueOffset: 0,
      penIndex: 2,
    },
  ],
})

describe('artwork library', () => {
  it('creates a valid unique storage key from an injected id', () => {
    expect(createArtworkStorageKey('abc-123')).toBe('pen.gallery.artwork.abc-123.v2')
    expect(createArtworkStorageKey('unsafe:/作品')).toBe('pen.gallery.artwork.unsafe.v2')
    expect(() => createArtworkStorageKey('作品')).toThrow(RangeError)
  })

  it('collects new and legacy artwork entries, ignores unrelated data, and sorts newest first', () => {
    const older = record('2026-08-12T00:00:00.000Z')
    const newer = record('2026-08-12T01:00:00.000Z')
    const artworks = collectStoredArtworks([
      { key: 'other.data', value: newer },
      { key: 'pen.gallery.canvas.1.v1', value: older },
      { key: 'pen.gallery.artwork.abc-123.v2', value: newer },
      { key: 'pen.gallery.artwork.invalid.v2', value: { bad: true } },
    ])

    expect(artworks.map((artwork) => artwork.key)).toEqual([
      'pen.gallery.artwork.abc-123.v2',
      'pen.gallery.canvas.1.v1',
    ])
    expect(artworks.map((artwork) => artwork.legacy)).toEqual([false, true])
  })

  it('only allows the recorded author to request deletion', () => {
    const artwork = collectStoredArtworks([
      { key: 'pen.gallery.artwork.abc.v2', value: record('2026-08-12T00:00:00.000Z') },
    ])[0]
    expect(canDeleteArtwork(artwork, 'user-a')).toBe(true)
    expect(canDeleteArtwork(artwork, 'user-b')).toBe(false)
    expect(canDeleteArtwork(artwork)).toBe(false)
  })

  it('cycles compact canvas selections and wraps at both ends', () => {
    const artworks = collectStoredArtworks([
      { key: 'pen.gallery.artwork.first.v2', value: record('2026-08-12T02:00:00.000Z') },
      { key: 'pen.gallery.artwork.second.v2', value: record('2026-08-12T01:00:00.000Z') },
      { key: 'pen.gallery.artwork.third.v2', value: record('2026-08-12T00:00:00.000Z') },
    ])
    const canvasOne = getCycledArtworkKey(artworks, artworks[0].key, 1)
    const canvasTwo = getCycledArtworkKey(artworks, artworks[2].key, -1)

    expect(canvasOne).toBe(artworks[1].key)
    expect(canvasTwo).toBe(artworks[1].key)
    expect(getCycledArtworkKey(artworks, artworks[2].key, 1)).toBe(artworks[0].key)
    expect(getCycledArtworkKey([], null, 1)).toBeNull()
  })
})

describe('trajectory playback', () => {
  const strokes: CanvasStroke[] = [
    {
      sid: 'user-a:1:mabc123:1',
      color: '#f00',
      pts: [0, 0, 0, 1, 0, 0, 2, 0, 0],
      hueOffset: 0,
      penIndex: 1,
    },
    {
      sid: 'user-a:2:mabc124:1',
      color: '#0f0',
      pts: [0, 0, 0, 0, 1, 0],
      hueOffset: 2,
      penIndex: 2,
    },
  ]

  it('counts drawable segments and clamps playback duration', () => {
    expect(countStrokeSegments(strokes)).toBe(3)
    expect(getPlaybackDurationMs(strokes)).toBe(1200)
    const longStroke = { ...strokes[0], pts: Array(1200).fill(0) }
    expect(getPlaybackDurationMs([longStroke])).toBe(12000)
  })

  it('reveals points in stroke order and supports blank/full frames', () => {
    expect(sliceStrokesForPlayback(strokes, 0)).toEqual([])
    expect(sliceStrokesForPlayback(strokes, 0.34)).toEqual([
      { ...strokes[0], pts: [0, 0, 0, 1, 0, 0, 2, 0, 0] },
    ])
    expect(sliceStrokesForPlayback(strokes, 0.67)).toEqual(strokes)
    expect(sliceStrokesForPlayback(strokes, 1)).toEqual(strokes)
  })

  it('orders playback by DcPen timestamp and counter while keeping stable ties', () => {
    const later = { ...strokes[0], sid: 'user-a:1:mabc125:1' }
    const first = { ...strokes[0], sid: 'user-a:1:mabc123:1' }
    const second = { ...strokes[1], sid: 'user-a:2:mabc123:2' }
    expect(sortStrokesForPlayback([later, second, first]).map((stroke) => stroke.sid)).toEqual([
      first.sid,
      second.sid,
      later.sid,
    ])
  })
})
