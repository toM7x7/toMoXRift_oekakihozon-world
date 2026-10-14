import type { WorldStorageEntry } from '@xrift/world-components'
import type { CanvasRecord, CanvasStroke } from './recording'
import { parseStrokeSid, validateCanvasRecord } from './recording'

export const ARTWORK_STORAGE_PREFIX = 'pen.gallery.artwork.'
export const LEGACY_CANVAS_STORAGE_PATTERN = /^pen\.gallery\.canvas\.[1-5]\.v1$/
export const ARTWORK_STORAGE_PATTERN = /^pen\.gallery\.artwork\.[A-Za-z0-9-]+\.v2$/

export interface StoredArtwork {
  key: string
  record: CanvasRecord
  legacy: boolean
}

export function createArtworkStorageKey(id: string): string {
  const safeId = id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 72)
  if (!safeId) throw new RangeError('Artwork id must contain a safe character')
  return `${ARTWORK_STORAGE_PREFIX}${safeId}.v2`
}

export function collectStoredArtworks(entries: readonly WorldStorageEntry[]): StoredArtwork[] {
  return entries
    .flatMap((entry): StoredArtwork[] => {
      const legacy = LEGACY_CANVAS_STORAGE_PATTERN.test(entry.key)
      if (!legacy && !ARTWORK_STORAGE_PATTERN.test(entry.key)) return []
      if (!validateCanvasRecord(entry.value)) return []
      return [{ key: entry.key, record: entry.value, legacy }]
    })
    .sort((left, right) => right.record.savedAt.localeCompare(left.record.savedAt))
}

export function canDeleteArtwork(artwork: StoredArtwork, userId?: string): boolean {
  return Boolean(userId && artwork.record.author.userId === userId)
}

export function getCycledArtworkKey(
  artworks: readonly StoredArtwork[],
  currentKey: string | null,
  delta: number,
): string | null {
  if (artworks.length === 0) return null
  const currentIndex = artworks.findIndex((artwork) => artwork.key === currentKey)
  const baseIndex = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = (baseIndex + delta + artworks.length) % artworks.length
  return artworks[nextIndex].key
}

export function countStrokeSegments(strokes: readonly CanvasStroke[]): number {
  return strokes.reduce(
    (total, stroke) => total + Math.max(0, stroke.pts.length / 3 - 1),
    0,
  )
}

export function sortStrokesForPlayback(strokes: readonly CanvasStroke[]): CanvasStroke[] {
  return strokes
    .map((stroke, originalIndex) => ({ stroke, originalIndex, parsed: parseStrokeSid(stroke.sid) }))
    .sort((left, right) =>
      (left.parsed?.timestamp ?? Number.MAX_SAFE_INTEGER) -
        (right.parsed?.timestamp ?? Number.MAX_SAFE_INTEGER) ||
      (left.parsed?.counter ?? Number.MAX_SAFE_INTEGER) -
        (right.parsed?.counter ?? Number.MAX_SAFE_INTEGER) ||
      left.originalIndex - right.originalIndex,
    )
    .map(({ stroke }) => cloneStroke(stroke))
}

export function getPlaybackDurationMs(strokes: readonly CanvasStroke[]): number {
  return Math.max(1200, Math.min(12000, countStrokeSegments(strokes) * 35))
}

export function sliceStrokesForPlayback(
  strokes: readonly CanvasStroke[],
  progress: number,
): CanvasStroke[] {
  const orderedStrokes = sortStrokesForPlayback(strokes)
  const totalSegments = countStrokeSegments(orderedStrokes)
  if (totalSegments === 0 || progress <= 0) return []
  if (progress >= 1) return orderedStrokes

  let remaining = Math.max(0, Math.ceil(totalSegments * progress))
  const visible: CanvasStroke[] = []

  for (const stroke of orderedStrokes) {
    if (remaining <= 0) break
    const pointCount = stroke.pts.length / 3
    const segmentCount = Math.max(0, pointCount - 1)
    if (segmentCount === 0) continue

    const visibleSegments = Math.min(segmentCount, remaining)
    visible.push({
      ...stroke,
      pts: stroke.pts.slice(0, (visibleSegments + 1) * 3),
      orientations: stroke.orientations?.slice(0, (visibleSegments + 1) * 4),
      pressures: stroke.pressures?.slice(0, visibleSegments + 1),
      timestamps: stroke.timestamps?.slice(0, visibleSegments + 1),
    })
    remaining -= visibleSegments
  }

  return visible
}

function cloneStroke(stroke: CanvasStroke): CanvasStroke {
  return {
    ...stroke,
    pts: [...stroke.pts],
    orientations: stroke.orientations ? [...stroke.orientations] : undefined,
    pressures: stroke.pressures ? [...stroke.pressures] : undefined,
    timestamps: stroke.timestamps ? [...stroke.timestamps] : undefined,
  }
}
