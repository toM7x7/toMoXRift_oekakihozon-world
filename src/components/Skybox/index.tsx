import { useTexture } from '@react-three/drei'
import { BackSide, SRGBColorSpace } from 'three'
import { useXRift } from '@xrift/world-components'

export interface SkyboxProps {
  /** skyboxのサイズ（半径） */
  radius?: number
  /** public配下の360度パノラマ画像 */
  src?: string
}

/**
 * Skyboxコンポーネント
 * 2:1の正距円筒図法パノラマを内向き球面へ表示します
 */
export const Skybox: React.FC<SkyboxProps> = ({
  radius = 120,
  src = 'pop-art-skybox-v1.png',
}) => {
  const { baseUrl } = useXRift()
  const texture = useTexture(`${baseUrl}${src}`)
  texture.colorSpace = SRGBColorSpace

  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[radius, 60, 40]} />
      <meshBasicMaterial
        map={texture}
        side={BackSide}
        fog={false}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  )
}
