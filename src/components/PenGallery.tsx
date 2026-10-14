import {
  WorldStorageError,
  useConfirm,
  useInstanceEvent,
  useInstanceState,
  useUsers,
  useWorldStorage,
} from '@xrift/world-components'
import { StrokeRenderer, type Stroke } from 'xrift-dcpen'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasBounds, CanvasRecord, CanvasStroke, SaveScope, SaveScopeKind } from '../gallery/recording'
import {
  ARTWORK_TITLE_MAX_LENGTH,
  createCanvasRecord,
  getArtworkTitle,
  normalizeArtworkTitle,
  validateCanvasRecord,
} from '../gallery/recording'
import type { StoredArtwork } from '../gallery/library'
import {
  canDeleteArtwork,
  collectStoredArtworks,
  createArtworkStorageKey,
  getCycledArtworkKey,
  getPlaybackDurationMs,
  sliceStrokesForPlayback,
} from '../gallery/library'
import { DCPEN_STROKES_STATE_KEY, DCPEN_SYNC_ID } from '../integrations/dcpen'
import { ActionButton, Panel, PanelText, TextInputActionButton } from './ui/WorldUi'

const CANVAS_WIDTH = 3
const CANVAS_HEIGHT = 2.2
const CANVAS_Y = 2.35
const CANVAS_Z = -8.04
const CAPTURE_CENTER_Z = -7.65
const SLOT_X = [-7.2, -3.6, 0, 3.6, 7.2] as const
const SAVE_SETTLE_MS = 3300
const WRITE_COOLDOWN_MS = 5000
const LIBRARY_PAGE_SIZE = 5
const LIBRARY_EVENT = 'pen-memory-gallery-library-changed-v2'

interface SlotDefinition {
  id: number
  x: number
  bounds: CanvasBounds
}

interface DisplayedArtwork {
  artwork: StoredArtwork
  progress: number
  playing: boolean
  startedAt: number
}

const SLOTS: SlotDefinition[] = SLOT_X.map((x, index) => ({
  id: index + 1,
  x,
  bounds: {
    min: [x - 1.42, 1.2, -8.25],
    max: [x + 1.42, 3.5, -7.05],
  },
}))

type SlotDisplays = Record<number, DisplayedArtwork | null>
type SlotMessages = Record<number, string>
type SlotSelections = Record<number, string | null>
type SlotSaveScopes = Record<number, SaveScopeKind>

const makeBlankDisplays = (): SlotDisplays =>
  Object.fromEntries(SLOTS.map((slot) => [slot.id, null])) as SlotDisplays

const makeInitialMessages = (): SlotMessages =>
  Object.fromEntries(SLOTS.map((slot) => [slot.id, ''])) as SlotMessages

const makeBlankSelections = (): SlotSelections =>
  Object.fromEntries(SLOTS.map((slot) => [slot.id, null])) as SlotSelections

const makeInitialSaveScopes = (): SlotSaveScopes =>
  Object.fromEntries(SLOTS.map((slot) => [slot.id, 'mine'])) as SlotSaveScopes

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, durationMs))

export interface PenGalleryProps {
  selectedPenIndex: number
}

export function PenGallery({ selectedPenIndex }: PenGalleryProps) {
  const storage = useWorldStorage()
  const { localUser } = useUsers()
  const { requestConfirm } = useConfirm()
  const [liveStrokes] = useInstanceState<Stroke[]>(DCPEN_STROKES_STATE_KEY, [])
  const liveStrokesRef = useRef(liveStrokes)
  const [artworks, setArtworks] = useState<StoredArtwork[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [slotSelectedKeys, setSlotSelectedKeys] = useState<SlotSelections>(makeBlankSelections)
  const [slotSaveScopes, setSlotSaveScopes] = useState<SlotSaveScopes>(makeInitialSaveScopes)
  const [libraryMessage, setLibraryMessage] = useState('保存作品を読込中…')
  const [pageIndex, setPageIndex] = useState(0)
  const [displays, setDisplays] = useState<SlotDisplays>(makeBlankDisplays)
  const [, setMessages] = useState<SlotMessages>(makeInitialMessages)
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const lastWriteAtRef = useRef(0)

  useEffect(() => {
    liveStrokesRef.current = liveStrokes
  }, [liveStrokes])

  const setSlotMessage = useCallback((slotId: number, message: string) => {
    setMessages((current) => ({ ...current, [slotId]: message }))
  }, [])

  const refreshLibrary = useCallback(async (preferredKey?: string) => {
    setLibraryMessage('保存作品を読込中…')
    try {
      const next = collectStoredArtworks(await storage.shared.list())
      setArtworks(next)
      setSelectedKey((current) => {
        const requested = preferredKey ?? current
        return requested && next.some((artwork) => artwork.key === requested)
          ? requested
          : next[0]?.key ?? null
      })
      setSlotSelectedKeys((current) =>
        Object.fromEntries(
          SLOTS.map((slot) => {
            const currentKey = current[slot.id]
            const nextKey = currentKey && next.some((artwork) => artwork.key === currentKey)
              ? currentKey
              : next[0]?.key ?? null
            return [slot.id, nextKey]
          }),
        ) as SlotSelections,
      )
      setPageIndex((current) =>
        Math.min(current, Math.max(0, Math.ceil(next.length / LIBRARY_PAGE_SIZE) - 1)),
      )
      setLibraryMessage(
        next.length === 0
          ? '登録作品はまだありません'
          : `${next.length}作品を読込みました。作品を選んでください`,
      )
    } catch (error) {
      setLibraryMessage(toJapaneseStorageError(error))
    }
  }, [storage])

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  const emitLibraryChanged = useInstanceEvent<{ key: string }>(
    LIBRARY_EVENT,
    () => void refreshLibrary(),
  )

  const selectedArtwork = useMemo(
    () => artworks.find((artwork) => artwork.key === selectedKey) ?? null,
    [artworks, selectedKey],
  )

  const pageCount = Math.max(1, Math.ceil(artworks.length / LIBRARY_PAGE_SIZE))
  const pageArtworks = artworks.slice(
    pageIndex * LIBRARY_PAGE_SIZE,
    (pageIndex + 1) * LIBRARY_PAGE_SIZE,
  )

  const changePage = useCallback((delta: number) => {
    const next = Math.min(pageCount - 1, Math.max(0, pageIndex + delta))
    setPageIndex(next)
    const firstArtwork = artworks[next * LIBRARY_PAGE_SIZE]
    if (firstArtwork) setSelectedKey(firstArtwork.key)
  }, [artworks, pageCount, pageIndex])

  const changeSlotSelection = useCallback((slotId: number, delta: number) => {
    if (artworks.length === 0) {
      setSlotMessage(slotId, '呼び出せる保存作品はまだありません')
      return
    }
    setSlotSelectedKeys((current) => {
      const nextKey = getCycledArtworkKey(artworks, current[slotId], delta)
      return { ...current, [slotId]: nextKey }
    })
  }, [artworks, setSlotMessage])

  const registerSlot = useCallback(async (
    slot: SlotDefinition,
    rawTitle: string,
    saveScopeKind: SaveScopeKind,
  ) => {
    const title = normalizeArtworkTitle(rawTitle)
    if (!title) {
      setSlotMessage(slot.id, '作品名を1文字以上入力してください')
      return
    }
    if (!localUser || localUser.isGuest) {
      setSlotMessage(slot.id, '公開保存にはXRiftログインが必要です')
      return
    }
    if (busySlot !== null || libraryBusy) return

    const cooldownRemaining = WRITE_COOLDOWN_MS - (Date.now() - lastWriteAtRef.current)
    if (cooldownRemaining > 0) {
      setSlotMessage(slot.id, `連続保存を抑制中（あと${Math.ceil(cooldownRemaining / 1000)}秒）`)
      return
    }

    setBusySlot(slot.id)
    setSlotMessage(slot.id, 'DcPenの最新線を同期中…（約3秒）')
    try {
      await wait(SAVE_SETTLE_MS)
      const savedAt = new Date().toISOString()
      const scope: SaveScope = saveScopeKind === 'mine'
        ? { kind: 'mine', userId: localUser.id }
        : saveScopeKind === 'pen'
          ? { kind: 'pen', penIndex: selectedPenIndex }
          : { kind: 'all' }
      const record = createCanvasRecord({
        slotId: slot.id,
        title,
        author: {
          userId: localUser.id,
          displayName: localUser.displayName || '名前なしユーザー',
        },
        savedAt,
        sourceSyncId: DCPEN_SYNC_ID,
        bounds: slot.bounds,
        strokes: liveStrokesRef.current,
        scope,
      })

      if (record.strokes.length === 0) {
        setSlotMessage(slot.id, `${getSaveScopeLabel(saveScopeKind, selectedPenIndex)}の線が、この枠内に見つかりません`)
        return
      }

      const randomId = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      const storageKey = createArtworkStorageKey(randomId)
      await storage.shared.set(storageKey, record)
      lastWriteAtRef.current = Date.now()

      const readback = await storage.shared.get(storageKey)
      if (
        !validateCanvasRecord(readback) ||
        readback.savedAt !== record.savedAt ||
        readback.author.userId !== record.author.userId ||
        readback.title !== record.title
      ) {
        throw new Error('保存後の読戻しが一致しませんでした')
      }

      await refreshLibrary(storageKey)
      setPageIndex(0)
      setSlotMessage(slot.id, `「${getArtworkTitle(readback)}」を作品一覧へ追加しました`)
      emitLibraryChanged({ key: storageKey })
    } catch (error) {
      setSlotMessage(slot.id, toJapaneseStorageError(error))
    } finally {
      setBusySlot(null)
    }
  }, [busySlot, emitLibraryChanged, libraryBusy, localUser, refreshLibrary, selectedPenIndex, setSlotMessage, storage])

  const cycleSlotSaveScope = useCallback((slotId: number) => {
    setSlotSaveScopes((current) => ({
      ...current,
      [slotId]: getNextSaveScopeKind(current[slotId]),
    }))
  }, [])

  const callArtwork = useCallback((slotId: number, artwork: StoredArtwork | null) => {
    if (!artwork) {
      setSlotMessage(slotId, 'キャンバス上の「前 / 次」で作品を選んでください')
      return
    }
    setDisplays((current) => ({
      ...current,
      [slotId]: {
        artwork,
        progress: 1,
        playing: false,
        startedAt: 0,
      },
    }))
    setSlotMessage(
      slotId,
      `「${getArtworkTitle(artwork.record)}」を呼び出しました`,
    )
  }, [setSlotMessage])

  const replayArtwork = useCallback((slotId: number, selectedSlotArtwork: StoredArtwork | null) => {
    const artwork = displays[slotId]?.artwork ?? selectedSlotArtwork
    if (!artwork) {
      setSlotMessage(slotId, '再生する作品をキャンバス上で選んでください')
      return
    }
    setDisplays((current) => ({
      ...current,
      [slotId]: {
        artwork,
        progress: 0,
        playing: true,
        startedAt: performance.now(),
      },
    }))
    setSlotMessage(slotId, `「${getArtworkTitle(artwork.record)}」の軌跡を再生中`)
  }, [displays, setSlotMessage])

  const clearDisplay = useCallback((slotId: number) => {
    setDisplays((current) => ({ ...current, [slotId]: null }))
    setSlotMessage(slotId, '呼出作品を消しました。保存作品は残っています')
  }, [setSlotMessage])

  const playingSignature = SLOTS
    .filter((slot) => displays[slot.id]?.playing)
    .map((slot) => slot.id)
    .join(',')

  useEffect(() => {
    if (!playingSignature) return
    const timerId = window.setInterval(() => {
      const now = performance.now()
      setDisplays((current) => {
        const next = { ...current }
        for (const slot of SLOTS) {
          const display = current[slot.id]
          if (!display?.playing) continue
          const duration = getPlaybackDurationMs(display.artwork.record.strokes)
          const progress = Math.min(1, (now - display.startedAt) / duration)
          next[slot.id] = { ...display, progress, playing: progress < 1 }
        }
        return next
      })
    }, 33)
    return () => window.clearInterval(timerId)
  }, [playingSignature])

  const deleteSelectedArtwork = useCallback(async () => {
    if (!selectedArtwork || !localUser || localUser.isGuest || libraryBusy) return
    if (!canDeleteArtwork(selectedArtwork, localUser.id)) {
      setLibraryMessage('保存作品を削除できるのは登録した本人だけです')
      return
    }

    const confirmed = await requestConfirm({
      title: `「${getArtworkTitle(selectedArtwork.record)}」を保存から削除`,
      message: 'この操作はWorld Storageから作品を削除します。元に戻せません。',
      confirmLabel: '保存から削除する',
      cancelLabel: 'やめる',
    })
    if (!confirmed) return

    setLibraryBusy(true)
    setLibraryMessage('保存作品を削除中…')
    try {
      await storage.shared.delete(selectedArtwork.key)
      setDisplays((current) =>
        Object.fromEntries(
          SLOTS.map((slot) => [
            slot.id,
            current[slot.id]?.artwork.key === selectedArtwork.key
              ? null
              : current[slot.id],
          ]),
        ) as SlotDisplays,
      )
      await refreshLibrary()
      emitLibraryChanged({ key: selectedArtwork.key })
      setLibraryMessage('保存作品を削除しました')
    } catch (error) {
      setLibraryMessage(toJapaneseStorageError(error))
    } finally {
      setLibraryBusy(false)
    }
  }, [emitLibraryChanged, libraryBusy, localUser, refreshLibrary, requestConfirm, selectedArtwork, storage])

  return (
    <group>
      <ArtworkLibraryPanel
        artworks={pageArtworks}
        totalCount={artworks.length}
        pageIndex={pageIndex}
        pageCount={pageCount}
        selectedKey={selectedKey}
        selectedArtwork={selectedArtwork}
        message={libraryMessage}
        deleteEnabled={Boolean(
          selectedArtwork && localUser && canDeleteArtwork(selectedArtwork, localUser.id),
        ) && !libraryBusy}
        onSelect={setSelectedKey}
        onPrevious={() => changePage(-1)}
        onNext={() => changePage(1)}
        onRefresh={() => void refreshLibrary()}
        onDelete={() => void deleteSelectedArtwork()}
      />

      {SLOTS.map((slot) => {
        const slotArtwork = artworks.find((artwork) => artwork.key === slotSelectedKeys[slot.id]) ?? null
        const selectionIndex = slotArtwork
          ? artworks.findIndex((artwork) => artwork.key === slotArtwork.key)
          : -1
        return (
          <CanvasSlot
            key={slot.id}
            slot={slot}
            display={displays[slot.id]}
            selectedArtwork={slotArtwork}
            selectionIndex={selectionIndex}
            selectionCount={artworks.length}
            busy={busySlot === slot.id}
            saveEnabled={busySlot === null && !libraryBusy && Boolean(localUser && !localUser.isGuest)}
            saveScope={slotSaveScopes[slot.id]}
            selectedPenIndex={selectedPenIndex}
            onCycleSaveScope={() => cycleSlotSaveScope(slot.id)}
            onRegister={(title) => void registerSlot(slot, title, slotSaveScopes[slot.id])}
            onPrevious={() => changeSlotSelection(slot.id, -1)}
            onNext={() => changeSlotSelection(slot.id, 1)}
            onCall={() => callArtwork(slot.id, slotArtwork)}
            onReplay={() => replayArtwork(slot.id, slotArtwork)}
            onClear={() => clearDisplay(slot.id)}
          />
        )
      })}
    </group>
  )
}

interface ArtworkLibraryPanelProps {
  artworks: StoredArtwork[]
  totalCount: number
  pageIndex: number
  pageCount: number
  selectedKey: string | null
  selectedArtwork: StoredArtwork | null
  message: string
  deleteEnabled: boolean
  onSelect: (key: string) => void
  onPrevious: () => void
  onNext: () => void
  onRefresh: () => void
  onDelete: () => void
}

function ArtworkLibraryPanel({
  artworks,
  totalCount,
  pageIndex,
  pageCount,
  selectedKey,
  selectedArtwork,
  message,
  deleteEnabled,
  onSelect,
  onPrevious,
  onNext,
  onRefresh,
  onDelete,
}: ArtworkLibraryPanelProps) {
  return (
    <group position={[0, 0, 14.4]} rotation={[0, Math.PI, 0]}>
      <Panel position={[0, 3.18, 3.4]} width={5} height={0.7} backgroundColor={0xf0f9ff} borderColor={0x2563eb}>
        <PanelText size={16}>保存作品一覧（{totalCount}件）</PanelText>
        <PanelText size={10} color={0x334155}>
          {selectedArtwork
            ? `選択中：「${getArtworkTitle(selectedArtwork.record)}」 / 作者：${getContributorLabel(selectedArtwork.record)}`
            : message}
        </PanelText>
      </Panel>

      {artworks.map((artwork, index) => (
        <ActionButton
          key={artwork.key}
          id={`pen-library-select-${artwork.key}`}
          label={`${pageIndex * LIBRARY_PAGE_SIZE + index + 1}. ${getArtworkTitle(artwork.record)}`}
          detail={`作者：${getContributorLabel(artwork.record)}${artwork.legacy ? ' / 旧保存' : ''}`}
          interactionText={`作品「${getArtworkTitle(artwork.record)}」を選択`}
          onInteract={() => onSelect(artwork.key)}
          position={[0, 2.58 - index * 0.39, 3.46]}
          width={4.8}
          height={0.32}
          color={selectedKey === artwork.key ? '#0f766e' : '#1d4ed8'}
        />
      ))}

      <ActionButton
        id="pen-library-previous"
        label="前ページ"
        detail={`${pageIndex + 1} / ${pageCount}`}
        interactionText="作品一覧の前ページ"
        onInteract={onPrevious}
        position={[-1.7, 0.55, 3.46]}
        width={1.2}
        height={0.34}
        enabled={pageIndex > 0}
      />
      <ActionButton
        id="pen-library-refresh"
        label="一覧更新"
        detail={`${totalCount}件を再読込`}
        interactionText="保存作品一覧を更新"
        onInteract={onRefresh}
        position={[0, 0.55, 3.46]}
        width={2}
        height={0.34}
        color="#475569"
      />
      <ActionButton
        id="pen-library-next"
        label="次ページ"
        detail={`${pageIndex + 1} / ${pageCount}`}
        interactionText="作品一覧の次ページ"
        onInteract={onNext}
        position={[1.7, 0.55, 3.46]}
        width={1.2}
        height={0.34}
        enabled={pageIndex < pageCount - 1}
      />
      <ActionButton
        id="pen-library-delete"
        label="選択作品を保存から削除"
        detail={deleteEnabled ? '登録した本人のみ / 確認あり' : '作者本人だけ削除できます'}
        interactionText="選択中の保存作品を削除"
        onInteract={onDelete}
        position={[0, 0.16, 3.46]}
        width={2.8}
        height={0.32}
        color="#b42318"
        enabled={deleteEnabled}
      />
    </group>
  )
}

interface CanvasSlotProps {
  slot: SlotDefinition
  display: DisplayedArtwork | null
  selectedArtwork: StoredArtwork | null
  selectionIndex: number
  selectionCount: number
  busy: boolean
  saveEnabled: boolean
  saveScope: SaveScopeKind
  selectedPenIndex: number
  onCycleSaveScope: () => void
  onRegister: (title: string) => void
  onPrevious: () => void
  onNext: () => void
  onCall: () => void
  onReplay: () => void
  onClear: () => void
}

function CanvasSlot({
  slot,
  display,
  selectedArtwork,
  selectionIndex,
  selectionCount,
  busy,
  saveEnabled,
  saveScope,
  selectedPenIndex,
  onCycleSaveScope,
  onRegister,
  onPrevious,
  onNext,
  onCall,
  onReplay,
  onClear,
}: CanvasSlotProps) {
  const record = display?.artwork.record ?? null
  const visibleStrokes = useMemo(
    () => record ? sliceStrokesForPlayback(record.strokes, display?.progress ?? 1) : [],
    [display?.progress, record],
  )
  const penIndexes = useMemo(
    () => [...new Set(record?.strokes.map((stroke) => stroke.penIndex) ?? [])].sort((a, b) => a - b),
    [record],
  )

  return (
    <group>
      <mesh position={[slot.x, CANVAS_Y, CANVAS_Z - 0.055]} castShadow>
        <boxGeometry args={[CANVAS_WIDTH + 0.14, CANVAS_HEIGHT + 0.14, 0.11]} />
        <meshStandardMaterial color="#5d6670" roughness={0.75} />
      </mesh>
      <mesh position={[slot.x, CANVAS_Y, CANVAS_Z]} receiveShadow>
        <boxGeometry args={[CANVAS_WIDTH, CANVAS_HEIGHT, 0.045]} />
        <meshStandardMaterial color="#fffefa" roughness={0.98} />
      </mesh>

      <Panel position={[slot.x, 3.84, -8.0]} width={2.75} height={0.62} backgroundColor={0xeff6ff} borderColor={0x6b9ac4}>
        <PanelText size={13} color={0x172033}>
          {record ? `作品名：${getArtworkTitle(record)}` : '作品名：未呼出'}
        </PanelText>
        <PanelText size={10}>キャンバス {slot.id}</PanelText>
        <PanelText size={8} color={0x475467}>
          {record
            ? `作者：${getContributorLabel(record)} / ペン ${penIndexes.map((index) => index + 1).join(', ')} / ${record.strokes.length}本`
            : '一覧から作品を選んで呼び出せます'}
        </PanelText>
      </Panel>

      <ActionButton
        id={`pen-gallery-select-previous-${slot.id}`}
        label="前"
        detail={selectionCount > 0 ? `${selectionIndex + 1}/${selectionCount}` : '0/0'}
        interactionText={`キャンバス${slot.id}の前の保存作品を選ぶ`}
        onInteract={onPrevious}
        position={[slot.x - 1.05, 0.18, -7.95]}
        width={0.52}
        height={0.32}
        color="#475569"
        enabled={selectionCount > 1 && !busy}
      />
      <Panel
        position={[slot.x, 0.18, -8.0]}
        width={1.42}
        height={0.32}
        backgroundColor={0xf8fafc}
        borderColor={0x64748b}
      >
        <PanelText size={8} color={0x334155}>
          {selectedArtwork
            ? `呼出候補：${getArtworkTitle(selectedArtwork.record)}`
            : '呼出候補：作品なし'}
        </PanelText>
      </Panel>
      <ActionButton
        id={`pen-gallery-select-next-${slot.id}`}
        label="次"
        detail={selectionCount > 0 ? `${selectionIndex + 1}/${selectionCount}` : '0/0'}
        interactionText={`キャンバス${slot.id}の次の保存作品を選ぶ`}
        onInteract={onNext}
        position={[slot.x + 1.05, 0.18, -7.95]}
        width={0.52}
        height={0.32}
        color="#475569"
        enabled={selectionCount > 1 && !busy}
      />

      {record ? (
        <group position={[slot.x, CANVAS_Y, CAPTURE_CENTER_Z]}>
          {visibleStrokes.map((stroke, index) => (
            <RecordedStroke key={`${stroke.sid}:${index}`} stroke={stroke} />
          ))}
        </group>
      ) : null}

      <ActionButton
        id={`pen-gallery-save-scope-${slot.id}`}
        label="保存対象"
        detail={getSaveScopeLabel(saveScope, selectedPenIndex)}
        interactionText={`キャンバス${slot.id}の保存対象を切り替える`}
        onInteract={onCycleSaveScope}
        position={[slot.x, 1.42, -7.95]}
        width={2.72}
        height={0.24}
        color={saveScope === 'all' ? '#b45309' : saveScope === 'pen' ? '#7c3aed' : '#0f766e'}
        enabled={!busy}
      />

      <TextInputActionButton
        id={`pen-gallery-register-${slot.id}`}
        label={busy ? '同期中…' : '新しい作品として登録'}
        detail={saveEnabled ? getSaveScopeLabel(saveScope, selectedPenIndex) : 'ログインが必要'}
        interactionText={`作品名を入力してキャンバス${slot.id}の絵を新規登録`}
        placeholder="作品名を入力"
        maxLength={ARTWORK_TITLE_MAX_LENGTH}
        onSubmit={onRegister}
        position={[slot.x - 0.72, 0.98, -7.95]}
        width={1.34}
        height={0.38}
        color="#0f766e"
        enabled={saveEnabled}
      />
      <ActionButton
        id={`pen-gallery-call-${slot.id}`}
        label="選択作品を呼出"
        detail={selectedArtwork
          ? `${getArtworkTitle(selectedArtwork.record)} / ${getContributorLabel(selectedArtwork.record)}`
          : '保存作品なし'}
        interactionText={`選択作品をキャンバス${slot.id}へ呼び出す`}
        onInteract={onCall}
        position={[slot.x + 0.72, 0.98, -7.95]}
        width={1.34}
        height={0.38}
        color="#1d4ed8"
        enabled={Boolean(selectedArtwork) && !busy}
      />
      <ActionButton
        id={`pen-gallery-replay-${slot.id}`}
        label={display?.playing ? '軌跡を再生中…' : '軌跡を再生'}
        detail="描いた順に表示"
        interactionText={`キャンバス${slot.id}で作品の軌跡を再生`}
        onInteract={onReplay}
        position={[slot.x - 0.72, 0.55, -7.95]}
        width={1.34}
        height={0.36}
        color="#7c3aed"
        enabled={Boolean(record || selectedArtwork) && !busy}
      />
      <ActionButton
        id={`pen-gallery-clear-${slot.id}`}
        label="呼出作品を消す"
        detail="保存は残ります"
        interactionText={`キャンバス${slot.id}の呼出作品だけを消す`}
        onInteract={onClear}
        position={[slot.x + 0.72, 0.55, -7.95]}
        width={1.34}
        height={0.36}
        color="#b45309"
        enabled={Boolean(record) && !busy}
      />
    </group>
  )
}

function RecordedStroke({ stroke }: { stroke: CanvasStroke }) {
  return <StrokeRenderer cacheKey={`gallery:${stroke.sid}`} stroke={stroke} count={stroke.pts.length} />
}

function getNextSaveScopeKind(current: SaveScopeKind): SaveScopeKind {
  if (current === 'mine') return 'pen'
  if (current === 'pen') return 'all'
  return 'mine'
}

function getSaveScopeLabel(scope: SaveScopeKind, selectedPenIndex: number): string {
  if (scope === 'mine') return '自分の線'
  if (scope === 'pen') return `選択ペン ${selectedPenIndex + 1}`
  return 'キャンバス内全部'
}

function getContributorLabel(record: CanvasRecord): string {
  const names = record.contributors?.map((contributor) => contributor.displayName) ?? []
  if (names.length === 0) return record.author.displayName
  if (names.length <= 2) return names.join('・')
  return `${names.slice(0, 2).join('・')}ほか${names.length - 2}名`
}

function toJapaneseStorageError(error: unknown): string {
  if (error instanceof WorldStorageError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        return 'ゲストは閲覧のみです。保存・削除にはログインが必要です'
      case 'RATE_LIMITED':
        return '保存回数が多すぎます。少し待って再試行してください'
      case 'ENTRY_TOO_LARGE':
      case 'QUOTA_EXCEEDED':
      case 'LIMIT_EXCEEDED':
        return '作品ライブラリの保存容量または件数上限を超えました'
      case 'NOT_IN_WORLD':
        return 'XRiftワールド参加中のみ保存できます'
      default:
        return `保存エラー: ${error.code}`
    }
  }
  return error instanceof Error ? error.message : '保存処理で不明なエラーが発生しました'
}
