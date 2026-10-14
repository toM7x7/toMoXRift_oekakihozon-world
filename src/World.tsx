import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { SpawnPoint } from '@xrift/world-components'
import { DcPen, type DcPenDebugApi, type Stroke } from 'xrift-dcpen'
import { useCallback, useState } from 'react'
import { PenGallery } from './components/PenGallery'
import { Skybox } from './components/Skybox'
import { Panel, PanelText } from './components/ui/WorldUi'
import { DCPEN_SYNC_ID, DCPEN_VERSION } from './integrations/dcpen'

export interface WorldProps {
  position?: [number, number, number]
  scale?: number
}

const FLOOR_SIZE: [number, number, number] = [32, 0.2, 32]
const WALL_SIZE: [number, number, number] = [19, 4.6, 0.2]
const WALL_POSITION: [number, number, number] = [0, 2.3, -8.3]
const IS_DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true
const DEV_QUERY = IS_DEV ? new URLSearchParams(window.location.search) : null
const BRUSH_LAB_PREVIEW = DEV_QUERY?.has('brushLab') === true
const QUICK_RING_PREVIEW = DEV_QUERY?.has('quickRing') === true
  ? DEV_QUERY.get('quickRing') === 'colors' ? 'colors' as const : true
  : false
const BRUSH_PREVIEW_STROKES: Stroke[] = [
  {
    sid: 'preview:0:brush:1', color: '#0f766e', hueOffset: 0, brushId: 'line',
    pts: [-1.25, 2.35, 3, -0.65, 2.55, 3, 0, 2.35, 3, 0.65, 2.55, 3, 1.25, 2.35, 3],
  },
  {
    sid: 'preview:1:brush:2', color: '#f97316', hueOffset: 0, brushId: 'ribbon', size: 0.065,
    pts: [-1.25, 1.98, 3, -0.65, 2.12, 3, 0, 1.98, 3, 0.65, 2.12, 3, 1.25, 1.98, 3],
    orientations: Array.from({ length: 5 }, () => [0, 0, 0, 1]).flat(),
    pressures: [0.2, 0.45, 0.7, 1, 0.35],
    timestamps: [0, 80, 160, 240, 320],
  },
  {
    sid: 'preview:2:brush:3', color: '#7c3aed', hueOffset: 0, brushId: 'calligraphy', size: 0.055,
    pts: [-1.25, 1.6, 3, -0.9, 1.72, 3, -0.4, 1.55, 3, 0.2, 1.75, 3, 0.75, 1.52, 3, 1.25, 1.65, 3],
    orientations: Array.from({ length: 6 }, () => [0, 0, 0, 1]).flat(),
    pressures: [1, 0.85, 0.6, 0.35, 0.8, 0.2],
    timestamps: [0, 90, 180, 270, 360, 450],
  },
]
const injectBrushPreview = (api: DcPenDebugApi) => api.inject(BRUSH_PREVIEW_STROKES)

export const World: React.FC<WorldProps> = ({ position = [0, 0, 0], scale = 1 }) => {
  const [selectedPenIndex, setSelectedPenIndex] = useState(0)
  const handleSelectedPenChange = useCallback((penIndex: number) => {
    setSelectedPenIndex(penIndex)
  }, [])

  return (
    <group position={position} scale={scale}>
      {/* The color remains as a lightweight fallback while the panorama loads. */}
      <color attach="background" args={['#dff4ff']} />
      <fog attach="fog" args={['#dff4ff', 24, 52]} />
      <Skybox radius={120} src="pop-art-skybox-v1.png" />
      <hemisphereLight args={['#ffffff', '#b8c5b2', 1.35]} />
      <directionalLight
        position={[7, 12, 8]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={12}
        shadow-camera-bottom={-8}
      />

      <RigidBody type="fixed" colliders={false} restitution={0} friction={0.9}>
        <CuboidCollider args={[FLOOR_SIZE[0] / 2, FLOOR_SIZE[1] / 2, FLOOR_SIZE[2] / 2]} position={[0, -0.1, 0]} />
        <mesh position={[0, -0.1, 0]} receiveShadow>
          <boxGeometry args={FLOOR_SIZE} />
          <meshStandardMaterial color="#eef3ea" roughness={0.95} />
        </mesh>
      </RigidBody>

      <gridHelper args={[32, 32, '#aeb8aa', '#d7ddd3']} position={[0, 0.012, 0]} />

      <RigidBody type="fixed" colliders={false} restitution={0} friction={0.8}>
        <CuboidCollider
          args={[WALL_SIZE[0] / 2, WALL_SIZE[1] / 2, WALL_SIZE[2] / 2]}
          position={WALL_POSITION}
        />
        <mesh position={WALL_POSITION} castShadow receiveShadow>
          <boxGeometry args={WALL_SIZE} />
          <meshStandardMaterial color="#f8f6ef" roughness={0.9} />
        </mesh>
      </RigidBody>

      <PenGallery selectedPenIndex={selectedPenIndex} />

      {/* Keep the shared pen rack beside the approach path so it never masks the five canvases. */}
      <group position={[8.2, 0, -0.8]} rotation={[0, -Math.PI / 2, 0]}>
        <DcPen
          syncId={DCPEN_SYNC_ID}
          position={[0, 0, 0]}
          rotationY={0}
          defaultBrush="line"
          enableQuickRing
          penCount={10}
          debugQuickRingPreview={QUICK_RING_PREVIEW}
          onSelectedPenChange={handleSelectedPenChange}
        />
      </group>
      {BRUSH_LAB_PREVIEW ? (
        <DcPen
          syncId={`${DCPEN_SYNC_ID}-preview`}
          position={[0, 0, 3.2]}
          penCount={10}
          enableBrushControls
          defaultBrush="ribbon"
          debugApi={injectBrushPreview}
        />
      ) : null}

      <Panel
        position={[-10.2, 1.55, -0.8]}
        rotation={[0, Math.PI / 2, 0]}
        width={3.8}
        height={2.05}
        backgroundColor={0xffffff}
      >
        <PanelText size={20}>使い方</PanelText>
        <PanelText size={11}>1. 各キャンバス上の「前 / 次」で作品を選ぶ</PanelText>
        <PanelText size={11}>2. 各面の「呼出」または「軌跡を再生」</PanelText>
        <PanelText size={11}>3. 「呼出作品を消す」は展示だけ白紙化</PanelText>
        <PanelText size={11}>4. 描いた絵は新しい作品として登録</PanelText>
        <PanelText size={10}>DcPenのUndo・消しゴム・Clear Mineは自分の線だけに作用</PanelText>
        <PanelText size={10} color={0x9a3412}>登録すると表示名と作品が公開保存されます</PanelText>
      </Panel>

      <Panel
        position={[10.2, 1.35, -0.8]}
        rotation={[0, -Math.PI / 2, 0]}
        width={3.8}
        height={1.85}
        backgroundColor={0xfffbeb}
        borderColor={0xd4a72c}
      >
        <PanelText size={17}>空間描画：DcPen by toming</PanelText>
        <PanelText size={11}>QvPen by ureishi へのリスペクトから生まれたXRift向け実装</PanelText>
        <PanelText size={10}>xrift-dcpen {DCPEN_VERSION} / xrift-grab / MIT License</PanelText>
        <PanelText size={9}>原作 toming / Brush Fork toM7x7</PanelText>
        <PanelText size={10} color={0xc2410c}>ペン保持中のトリガー2連打でクイックリングを開く</PanelText>
        <PanelText size={9}>ペン先で通常線・リボン・筆・消しゴム・色を選択</PanelText>
      </Panel>

      <SpawnPoint
        position={[0, 0.05, 6]}
        yaw={0}
      />
    </group>
  )
}
