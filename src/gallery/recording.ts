import type { BrushId, Stroke } from 'xrift-dcpen'

export const CANVAS_SLOT_IDS = [1, 2, 3, 4, 5] as const
export const MAX_CANVAS_RECORD_BYTES = 90 * 1024
export const ARTWORK_TITLE_MAX_LENGTH = 24

export type Point3 = readonly [number, number, number]

export interface CanvasBounds {
  min: Point3
  max: Point3
}

export interface ParsedStrokeSid {
  userId: string
  penIndex: number
  timestampToken: string
  timestamp: number
  counter: number
}

export interface CanvasStroke {
  sid: string
  color: string
  pts: number[]
  hueOffset: number
  penIndex: number
  ownerUserId?: string
  ownerDisplayName?: string
  brushId?: BrushId
  size?: number
  orientations?: number[]
  pressures?: number[]
  timestamps?: number[]
}

export interface CanvasRecord {
  version: 1 | 2
  slotId: number
  /** Optional only so records created before artwork titles existed remain readable. */
  title?: string
  author: {
    userId: string
    displayName: string
  }
  /** All stroke authors. Absent on legacy v1 records. */
  contributors?: Array<{
    userId: string
    displayName: string
  }>
  /** The capture filter selected by the saver. Absent on legacy v1 records. */
  saveScope?: SaveScopeKind
  savedAt: string
  sourceSyncId: string
  strokes: CanvasStroke[]
}

export type SaveScopeKind = 'mine' | 'pen' | 'all'

export type SaveScope =
  | { kind: 'mine'; userId: string }
  | { kind: 'pen'; penIndex: number }
  | { kind: 'all' }

export interface CreateCanvasRecordInput {
  slotId: number
  title: string
  author: CanvasRecord['author']
  savedAt: string
  sourceSyncId: string
  bounds: CanvasBounds
  strokes: readonly Stroke[]
  scope?: SaveScope
  maxBytes?: number
}

const SID_PATTERN = /^([^:]+):(\d+):([0-9a-z]+):(\d+)$/
const MILLIMETRE_EPSILON = 1e-9

export function parseStrokeSid(sid: string): ParsedStrokeSid | null {
  const match = SID_PATTERN.exec(sid)
  if (!match) return null

  const [, userId, penIndexToken, timestampToken, counterToken] = match
  const penIndex = Number(penIndexToken)
  const timestamp = Number.parseInt(timestampToken, 36)
  const counter = Number(counterToken)

  if (
    !Number.isSafeInteger(penIndex) ||
    penIndex < 0 ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    !Number.isSafeInteger(counter) ||
    counter < 0
  ) {
    return null
  }

  return { userId, penIndex, timestampToken, timestamp, counter }
}

export function filterStrokesByUser(
  strokes: readonly Stroke[],
  userId: string,
): Stroke[] {
  return strokes.filter((stroke) => getStrokeOwnerUserId(stroke) === userId)
}

export function filterStrokesForScope(
  strokes: readonly Stroke[],
  scope: SaveScope,
): Stroke[] {
  if (scope.kind === 'all') return [...strokes]
  if (scope.kind === 'mine') return filterStrokesByUser(strokes, scope.userId)
  return strokes.filter((stroke) => getStrokePenIndex(stroke) === scope.penIndex)
}

export function segmentStrokeForCanvas(
  stroke: Stroke,
  bounds: CanvasBounds,
): CanvasStroke[] {
  assertCanvasBounds(bounds)

  const parsedSid = parseStrokeSid(stroke.sid)
  if (
    !parsedSid ||
    typeof stroke.color !== 'string' ||
    !Number.isInteger(stroke.hueOffset) ||
    stroke.hueOffset < 0
  ) {
    return []
  }

  const center: Point3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const segments: CanvasStroke[] = []
  let currentPoints: number[] = []
  let segmentStartPoint = 0

  const flush = () => {
    // A single point cannot form a visible polyline, so it is not recorded.
    if (currentPoints.length >= 6) {
      segments.push({
        sid: stroke.sid,
        color: stroke.color,
        pts: currentPoints,
        hueOffset: stroke.hueOffset + segmentStartPoint,
        penIndex: getStrokePenIndex(stroke) ?? parsedSid.penIndex,
        ownerUserId: getStrokeOwnerUserId(stroke) ?? parsedSid.userId,
        ownerDisplayName: getStrokeOwnerDisplayName(stroke) ?? parsedSid.userId,
        brushId: stroke.brushId,
        size: stroke.size,
        orientations: stroke.orientations?.slice(segmentStartPoint * 4, (segmentStartPoint + currentPoints.length / 3) * 4),
        pressures: stroke.pressures?.slice(segmentStartPoint, segmentStartPoint + currentPoints.length / 3),
        timestamps: stroke.timestamps?.slice(segmentStartPoint, segmentStartPoint + currentPoints.length / 3),
      })
    }
    currentPoints = []
  }

  const pointCount = Math.floor(stroke.pts.length / 3)
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const offset = pointIndex * 3
    const point: Point3 = [
      stroke.pts[offset],
      stroke.pts[offset + 1],
      stroke.pts[offset + 2],
    ]

    if (!isFinitePoint(point) || !isPointInsideBounds(point, bounds)) {
      flush()
      continue
    }

    if (currentPoints.length === 0) segmentStartPoint = pointIndex
    currentPoints.push(
      roundMillimetres(point[0] - center[0]),
      roundMillimetres(point[1] - center[1]),
      roundMillimetres(point[2] - center[2]),
    )
  }
  flush()

  return segments
}

export function recordStrokesForCanvas(
  strokes: readonly Stroke[],
  userId: string,
  bounds: CanvasBounds,
): CanvasStroke[] {
  return filterStrokesByUser(strokes, userId).flatMap((stroke) =>
    segmentStrokeForCanvas(stroke, bounds),
  )
}

export function recordStrokesForScope(
  strokes: readonly Stroke[],
  scope: SaveScope,
  bounds: CanvasBounds,
): CanvasStroke[] {
  return filterStrokesForScope(strokes, scope).flatMap((stroke) =>
    segmentStrokeForCanvas(stroke, bounds),
  )
}

export function createCanvasRecord(input: CreateCanvasRecordInput): CanvasRecord {
  if (!isCanvasSlotId(input.slotId)) {
    throw new RangeError(`slotId must be one of ${CANVAS_SLOT_IDS.join(', ')}`)
  }

  const title = normalizeArtworkTitle(input.title)
  if (!title) throw new RangeError('Artwork title must not be empty')

  const scope = input.scope ?? { kind: 'mine', userId: input.author.userId }
  const strokes = recordStrokesForScope(input.strokes, scope, input.bounds)
  const contributors = collectContributors(strokes)
  const record: CanvasRecord = {
    version: 2,
    slotId: input.slotId,
    title,
    author: { ...input.author },
    contributors,
    saveScope: scope.kind,
    savedAt: input.savedAt,
    sourceSyncId: input.sourceSyncId,
    strokes,
  }

  return fitCanvasRecordToByteLimit(record, input.maxBytes)
}

export function fitCanvasRecordToByteLimit(
  record: CanvasRecord,
  maxBytes = MAX_CANVAS_RECORD_BYTES,
): CanvasRecord {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('maxBytes must be a positive safe integer')
  }

  const fitted = cloneCanvasRecord(record)
  if (getJsonByteLength(fitted) <= maxBytes) return fitted

  const metadataOnly: CanvasRecord = { ...fitted, strokes: [] }
  if (getJsonByteLength(metadataOnly) > maxBytes) {
    throw new RangeError('CanvasRecord metadata exceeds the byte limit')
  }

  let changed = true
  while (getJsonByteLength(fitted) > maxBytes && changed) {
    changed = false
    for (const stroke of fitted.strokes) {
      if (stroke.pts.length > 6) {
        halveStrokePointDensity(stroke)
        changed = true
      }
    }
  }

  // In pathological records, per-stroke metadata plus two endpoints can still
  // exceed the limit. Drop trailing strokes deterministically as a last resort.
  while (getJsonByteLength(fitted) > maxBytes && fitted.strokes.length > 0) {
    fitted.strokes.pop()
  }

  return fitted
}

export function getJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function validateCanvasRecord(value: unknown): value is CanvasRecord {
  try {
    if (!isObjectRecord(value)) return false
    if ((value.version !== 1 && value.version !== 2) || !isCanvasSlotId(value.slotId)) return false
    if (
      value.title !== undefined &&
      (!isNonEmptyString(value.title) ||
        Array.from(value.title).length > ARTWORK_TITLE_MAX_LENGTH)
    ) {
      return false
    }
    if (!isObjectRecord(value.author)) return false

    const userId = value.author.userId
    if (!isNonEmptyString(userId) || !isNonEmptyString(value.author.displayName)) {
      return false
    }
    if (!isIsoDateString(value.savedAt) || !isNonEmptyString(value.sourceSyncId)) {
      return false
    }
    if (!Array.isArray(value.strokes)) return false

    const contributorIds = new Set<string>()
    if (value.version === 2) {
      if (
        !Array.isArray(value.contributors) ||
        !isSaveScopeKind(value.saveScope)
      ) return false
      for (const contributor of value.contributors) {
        if (
          !isObjectRecord(contributor) ||
          !isNonEmptyString(contributor.userId) ||
          !isNonEmptyString(contributor.displayName) ||
          contributorIds.has(contributor.userId)
        ) return false
        contributorIds.add(contributor.userId)
      }
    }

    for (const candidate of value.strokes) {
      if (!isObjectRecord(candidate)) return false
      if (!isNonEmptyString(candidate.sid) || !isNonEmptyString(candidate.color)) {
        return false
      }
      if (
        !Number.isInteger(candidate.hueOffset) ||
        (candidate.hueOffset as number) < 0 ||
        !Number.isInteger(candidate.penIndex) ||
        (candidate.penIndex as number) < 0
      ) {
        return false
      }

      const parsedSid = parseStrokeSid(candidate.sid)
      if (
        !parsedSid ||
        (value.version === 1 && parsedSid.userId !== userId) ||
        parsedSid.penIndex !== candidate.penIndex
      ) {
        return false
      }
      if (value.version === 2) {
        if (
          !isNonEmptyString(candidate.ownerUserId) ||
          candidate.ownerUserId !== parsedSid.userId ||
          !isNonEmptyString(candidate.ownerDisplayName) ||
          !contributorIds.has(candidate.ownerUserId)
        ) return false
      }
      if (
        !Array.isArray(candidate.pts) ||
        candidate.pts.length < 6 ||
        candidate.pts.length % 3 !== 0 ||
        !candidate.pts.every(isMillimetreRoundedNumber)
      ) {
        return false
      }
      const pointCount = candidate.pts.length / 3
      if (
        candidate.brushId !== undefined &&
        candidate.brushId !== 'line' &&
        candidate.brushId !== 'ribbon' &&
        candidate.brushId !== 'calligraphy'
      ) return false
      if (candidate.size !== undefined && (!isMillimetreRoundedNumber(candidate.size) || candidate.size <= 0)) return false
      if (!isOptionalRoundedArray(candidate.orientations, pointCount * 4)) return false
      if (!isOptionalRoundedArray(candidate.pressures, pointCount, 0, 1)) return false
      if (
        candidate.timestamps !== undefined &&
        (!Array.isArray(candidate.timestamps) ||
          candidate.timestamps.length !== pointCount ||
          !candidate.timestamps.every((value) => Number.isSafeInteger(value) && value >= 0))
      ) return false
    }

    return getJsonByteLength(value) <= MAX_CANVAS_RECORD_BYTES
  } catch {
    return false
  }
}

export const isCanvasRecord = validateCanvasRecord

export function normalizeArtworkTitle(value: string): string {
  return Array.from(value.normalize('NFKC').trim().replace(/\s+/g, ' '))
    .slice(0, ARTWORK_TITLE_MAX_LENGTH)
    .join('')
}

export function getArtworkTitle(record: CanvasRecord): string {
  return record.title || '無題'
}

function assertCanvasBounds(bounds: CanvasBounds): void {
  if (
    !isFinitePoint(bounds.min) ||
    !isFinitePoint(bounds.max) ||
    bounds.min.some((minimum, axis) => minimum > bounds.max[axis])
  ) {
    throw new RangeError('Canvas bounds must be finite and min must not exceed max')
  }
}

function isPointInsideBounds(point: Point3, bounds: CanvasBounds): boolean {
  return point.every(
    (coordinate, axis) =>
      coordinate >= bounds.min[axis] && coordinate <= bounds.max[axis],
  )
}

function isFinitePoint(point: Point3): boolean {
  return point.every(Number.isFinite)
}

function roundMillimetres(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

function pointIndexesAtHalfDensity(pointCount: number): number[] {
  if (pointCount <= 2) return Array.from({ length: pointCount }, (_, index) => index)
  const result: number[] = []
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 2) {
    result.push(pointIndex)
  }
  const lastPointIndex = pointCount - 1
  if (lastPointIndex % 2 !== 0) result.push(lastPointIndex)
  return result
}

function selectFlatValues(values: readonly number[], stride: number, indexes: readonly number[]): number[] {
  return indexes.flatMap((index) => values.slice(index * stride, index * stride + stride))
}

function halveStrokePointDensity(stroke: CanvasStroke): void {
  const indexes = pointIndexesAtHalfDensity(stroke.pts.length / 3)
  stroke.pts = selectFlatValues(stroke.pts, 3, indexes)
  if (stroke.orientations) stroke.orientations = selectFlatValues(stroke.orientations, 4, indexes)
  if (stroke.pressures) stroke.pressures = selectFlatValues(stroke.pressures, 1, indexes)
  if (stroke.timestamps) stroke.timestamps = selectFlatValues(stroke.timestamps, 1, indexes)
}

function cloneCanvasRecord(record: CanvasRecord): CanvasRecord {
  return {
    ...record,
    author: { ...record.author },
    contributors: record.contributors?.map((contributor) => ({ ...contributor })),
    strokes: record.strokes.map((stroke) => ({
      ...stroke,
      pts: [...stroke.pts],
      orientations: stroke.orientations ? [...stroke.orientations] : undefined,
      pressures: stroke.pressures ? [...stroke.pressures] : undefined,
      timestamps: stroke.timestamps ? [...stroke.timestamps] : undefined,
    })),
  }
}

function collectContributors(strokes: readonly CanvasStroke[]): NonNullable<CanvasRecord['contributors']> {
  const contributors = new Map<string, string>()
  for (const stroke of strokes) {
    const userId = stroke.ownerUserId ?? parseStrokeSid(stroke.sid)?.userId
    if (!userId || contributors.has(userId)) continue
    contributors.set(userId, stroke.ownerDisplayName || userId)
  }
  return [...contributors].map(([userId, displayName]) => ({ userId, displayName }))
}

function getStrokeOwnerUserId(stroke: Stroke): string | undefined {
  return stroke.ownerUserId || parseStrokeSid(stroke.sid)?.userId
}

function getStrokeOwnerDisplayName(stroke: Stroke): string | undefined {
  return stroke.ownerDisplayName || getStrokeOwnerUserId(stroke)
}

function getStrokePenIndex(stroke: Stroke): number | undefined {
  return Number.isInteger(stroke.penIndex) && (stroke.penIndex as number) >= 0
    ? stroke.penIndex
    : parseStrokeSid(stroke.sid)?.penIndex
}

function isSaveScopeKind(value: unknown): value is SaveScopeKind {
  return value === 'mine' || value === 'pen' || value === 'all'
}

function isCanvasSlotId(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (CANVAS_SLOT_IDS as readonly number[]).includes(value as number)
  )
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function isMillimetreRoundedNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value * 1000 - Math.round(value * 1000)) < MILLIMETRE_EPSILON
  )
}

function isOptionalRoundedArray(value: unknown, length: number, min?: number, max?: number): boolean {
  if (value === undefined) return true
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) =>
      isMillimetreRoundedNumber(entry) &&
      (min === undefined || entry >= min) &&
      (max === undefined || entry <= max),
    )
  )
}
