import { describe, expect, it } from 'vitest'
import type { Stroke } from 'xrift-dcpen'
import {
  CANVAS_SLOT_IDS,
  ARTWORK_TITLE_MAX_LENGTH,
  MAX_CANVAS_RECORD_BYTES,
  createCanvasRecord,
  filterStrokesByUser,
  fitCanvasRecordToByteLimit,
  getJsonByteLength,
  getArtworkTitle,
  normalizeArtworkTitle,
  parseStrokeSid,
  recordStrokesForCanvas,
  recordStrokesForScope,
  segmentStrokeForCanvas,
  validateCanvasRecord,
  type CanvasBounds,
  type CanvasRecord,
} from './recording'

const bounds: CanvasBounds = {
  min: [0, 0, 0],
  max: [2, 2, 0.2],
}

const makeStroke = (overrides: Partial<Stroke> = {}): Stroke => ({
  sid: 'user-a:2:mabc123:7',
  color: '#ff0000',
  pts: [0, 0, 0, 1, 1, 0.1],
  hueOffset: 0,
  ...overrides,
})

const makeRecord = (overrides: Partial<CanvasRecord> = {}): CanvasRecord => ({
  version: 1,
  slotId: 1,
  title: '朝のひかり',
  author: { userId: 'user-a', displayName: 'テストユーザー' },
  savedAt: '2026-08-12T00:00:00.000Z',
  sourceSyncId: 'gallery-dcpen',
  strokes: [
    {
      sid: 'user-a:2:mabc123:7',
      color: '#ff0000',
      pts: [-1, -1, -0.1, 0, 0, 0],
      hueOffset: 0,
      penIndex: 2,
    },
  ],
  ...overrides,
})

describe('parseStrokeSid', () => {
  it('parses DcPen user, pen, base36 timestamp, and counter fields', () => {
    const timestamp = Date.now()
    const token = timestamp.toString(36)

    expect(parseStrokeSid(`user-42:14:${token}:3`)).toEqual({
      userId: 'user-42',
      penIndex: 14,
      timestampToken: token,
      timestamp,
      counter: 3,
    })
  })

  it.each([
    '',
    'user:1:abc',
    'user:pen:abc:1',
    'user:1:not-valid!:1',
    'user:1:abc:-1',
    'user:1:abc:1:extra',
  ])('rejects malformed sid %j', (sid) => {
    expect(parseStrokeSid(sid)).toBeNull()
  })
})

describe('canvas stroke extraction', () => {
  it('keeps ribbon orientation, pressure, and timing aligned for saved playback', () => {
    const stroke = makeStroke({
      brushId: 'ribbon',
      size: 0.035,
      orientations: [0, 0, 0, 1, 0, 0, 0, 1],
      pressures: [0.3, 0.9],
      timestamps: [0, 24],
    })

    expect(segmentStrokeForCanvas(stroke, bounds)[0]).toMatchObject({
      brushId: 'ribbon',
      size: 0.035,
      orientations: stroke.orientations,
      pressures: [0.3, 0.9],
      timestamps: [0, 24],
    })
  })

  it('keeps the calligraphy brush id for save and replay', () => {
    const stroke = makeStroke({
      brushId: 'calligraphy',
      size: 0.05,
      orientations: [0, 0, 0, 1, 0, 0, 0, 1],
      pressures: [1, 0.3],
      timestamps: [0, 32],
    })
    expect(segmentStrokeForCanvas(stroke, bounds)[0]).toMatchObject({
      brushId: 'calligraphy',
      size: 0.05,
      pressures: [1, 0.3],
    })
  })

  it('keeps only contiguous in-bounds runs and stores center-relative mm coordinates', () => {
    const stroke = makeStroke({
      hueOffset: 7,
      pts: [
        -1, 1, 0.1, // outside
        0.0004, 1.2346, 0.1004, // inside, run 1
        1.5004, 1, 0.2, // inside, run 1
        3, 1, 0.1, // outside
        1, 0, 0, // inside, run 2
        1, 2, 0.1, // inside, run 2
      ],
    })

    expect(segmentStrokeForCanvas(stroke, bounds)).toEqual([
      {
        sid: stroke.sid,
        color: stroke.color,
        pts: [-1, 0.235, 0, 0.5, 0, 0.1],
        hueOffset: 8,
        penIndex: 2,
        ownerUserId: 'user-a',
        ownerDisplayName: 'user-a',
      },
      {
        sid: stroke.sid,
        color: stroke.color,
        pts: [0, -1, -0.1, 0, 1, 0],
        hueOffset: 11,
        penIndex: 2,
        ownerUserId: 'user-a',
        ownerDisplayName: 'user-a',
      },
    ])
  })

  it('drops isolated in-bounds points because they cannot form a line', () => {
    const stroke = makeStroke({
      pts: [-1, 0, 0, 1, 1, 0.1, 3, 0, 0],
    })

    expect(segmentStrokeForCanvas(stroke, bounds)).toEqual([])
  })

  it('filters exact user ownership before segmenting', () => {
    const userA = makeStroke()
    const userB = makeStroke({ sid: 'user-b:1:mabc124:1' })
    const malformed = makeStroke({ sid: 'malformed' })

    expect(filterStrokesByUser([userA, userB, malformed], 'user-a')).toEqual([
      userA,
    ])
    expect(recordStrokesForCanvas([userA, userB, malformed], 'user-a', bounds)).toHaveLength(1)
  })

  it('captures one physical pen across multiple authors or every in-bounds stroke', () => {
    const authorA = makeStroke({ ownerDisplayName: '作者A' })
    const authorB = makeStroke({
      sid: 'user-b:2:mabc124:1',
      ownerUserId: 'user-b',
      ownerDisplayName: '作者B',
    })
    const otherPen = makeStroke({ sid: 'user-c:4:mabc125:1', penIndex: 4 })

    expect(recordStrokesForScope(
      [authorA, authorB, otherPen],
      { kind: 'pen', penIndex: 2 },
      bounds,
    ).map((stroke) => stroke.ownerUserId)).toEqual(['user-a', 'user-b'])
    expect(recordStrokesForScope(
      [authorA, authorB, otherPen],
      { kind: 'all' },
      bounds,
    )).toHaveLength(3)
  })
})

describe('CanvasRecord size fitting', () => {
  it('downsamples points without mutating input and stays within 90 KiB', () => {
    const pts = Array.from({ length: 12_000 }, (_, pointIndex) => [
      (pointIndex % 1000) / 1000,
      ((pointIndex * 3) % 1000) / 1000,
      ((pointIndex * 7) % 1000) / 1000,
    ]).flat()
    const record = makeRecord({
      strokes: [{ ...makeRecord().strokes[0], pts }],
    })
    const originalLength = record.strokes[0].pts.length
    const firstPoint = record.strokes[0].pts.slice(0, 3)
    const lastPoint = record.strokes[0].pts.slice(-3)

    expect(getJsonByteLength(record)).toBeGreaterThan(MAX_CANVAS_RECORD_BYTES)

    const fitted = fitCanvasRecordToByteLimit(record)

    expect(getJsonByteLength(fitted)).toBeLessThanOrEqual(MAX_CANVAS_RECORD_BYTES)
    expect(fitted.strokes[0].pts.length).toBeLessThan(originalLength)
    expect(fitted.strokes[0].pts.slice(0, 3)).toEqual(firstPoint)
    expect(fitted.strokes[0].pts.slice(-3)).toEqual(lastPoint)
    expect(record.strokes[0].pts).toHaveLength(originalLength)
  })
})

describe('CanvasRecord validation and creation', () => {
  it('accepts a valid record and rejects ownership, slot, precision, and shape violations', () => {
    const valid = makeRecord()
    expect(validateCanvasRecord(valid)).toBe(true)
    expect(validateCanvasRecord({ ...valid, slotId: 6 })).toBe(false)
    expect(validateCanvasRecord({ ...valid, title: '' })).toBe(false)
    expect(
      validateCanvasRecord({
        ...valid,
        title: 'あ'.repeat(ARTWORK_TITLE_MAX_LENGTH + 1),
      }),
    ).toBe(false)
    expect(
      validateCanvasRecord({
        ...valid,
        strokes: [{ ...valid.strokes[0], sid: 'user-b:2:mabc123:7' }],
      }),
    ).toBe(false)
    expect(
      validateCanvasRecord({
        ...valid,
        strokes: [{ ...valid.strokes[0], penIndex: 3 }],
      }),
    ).toBe(false)
    expect(
      validateCanvasRecord({
        ...valid,
        strokes: [{ ...valid.strokes[0], pts: [0.0001, 0, 0, 1, 1, 1] }],
      }),
    ).toBe(false)
    expect(validateCanvasRecord({ ...valid, strokes: [{}] })).toBe(false)
    expect(validateCanvasRecord(null)).toBe(false)
  })

  it('creates one of five slots from only the requested user and applies the byte cap', () => {
    expect(CANVAS_SLOT_IDS).toEqual([1, 2, 3, 4, 5])

    const record = createCanvasRecord({
      slotId: 5,
      title: '  わたしの   作品  ',
      author: { userId: 'user-a', displayName: '作者A' },
      savedAt: '2026-08-12T00:00:00.000Z',
      sourceSyncId: 'gallery-dcpen',
      bounds,
      strokes: [
        makeStroke(),
        makeStroke({ sid: 'user-b:1:mabc124:1' }),
      ],
    })

    expect(record.slotId).toBe(5)
    expect(record.version).toBe(2)
    expect(record.saveScope).toBe('mine')
    expect(record.title).toBe('わたしの 作品')
    expect(record.strokes).toHaveLength(1)
    expect(record.strokes[0].penIndex).toBe(2)
    expect(validateCanvasRecord(record)).toBe(true)
  })

  it('creates a valid multi-author pen record with contributor names', () => {
    const record = createCanvasRecord({
      slotId: 2,
      title: '共同制作',
      author: { userId: 'saver', displayName: '保存者' },
      savedAt: '2026-08-12T00:00:00.000Z',
      sourceSyncId: 'gallery-dcpen',
      bounds,
      scope: { kind: 'pen', penIndex: 2 },
      strokes: [
        makeStroke({ ownerDisplayName: '作者A' }),
        makeStroke({
          sid: 'user-b:2:mabc124:1',
          ownerUserId: 'user-b',
          ownerDisplayName: '作者B',
        }),
      ],
    })

    expect(record.contributors).toEqual([
      { userId: 'user-a', displayName: '作者A' },
      { userId: 'user-b', displayName: '作者B' },
    ])
    expect(record.strokes).toHaveLength(2)
    expect(validateCanvasRecord(record)).toBe(true)
    expect(validateCanvasRecord({ ...record, contributors: record.contributors?.slice(0, 1) })).toBe(false)
  })

  it('keeps legacy untitled records readable and gives them a display fallback', () => {
    const legacy = makeRecord({ title: undefined })
    expect(validateCanvasRecord(legacy)).toBe(true)
    expect(getArtworkTitle(legacy)).toBe('無題')
  })

  it('normalizes and safely limits artwork titles', () => {
    expect(normalizeArtworkTitle('  ＡＲＴ   作品  ')).toBe('ART 作品')
    expect(normalizeArtworkTitle('絵'.repeat(40))).toHaveLength(
      ARTWORK_TITLE_MAX_LENGTH,
    )
    expect(normalizeArtworkTitle('   ')).toBe('')
  })

  it('never throws while rejecting cyclic unknown input', () => {
    const cyclic: Record<string, unknown> = { ...makeRecord() }
    cyclic.extra = cyclic
    expect(validateCanvasRecord(cyclic)).toBe(false)
  })
})
