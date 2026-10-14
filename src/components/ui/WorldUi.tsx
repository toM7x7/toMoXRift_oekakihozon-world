import { Container, Text } from '@react-three/uikit'
import { Interactable, TextInput, useDefaultFont } from '@xrift/world-components'
import type { ReactNode } from 'react'

interface PanelProps {
  position?: [number, number, number]
  rotation?: [number, number, number]
  width: number
  height: number
  backgroundColor?: number
  borderColor?: number
  children: ReactNode
}

export function Panel({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  width,
  height,
  backgroundColor = 0xffffff,
  borderColor = 0x7a8797,
  children,
}: PanelProps) {
  const fontFamilies = useDefaultFont(['ja'])

  return (
    <group position={position} rotation={rotation}>
      <Container
        sizeX={width}
        sizeY={height}
        pixelSize={0.01}
        backgroundColor={backgroundColor}
        borderColor={borderColor}
        borderWidth={3}
        borderRadius={12}
        padding={14}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        gap={8}
        fontFamilies={fontFamilies}
      >
        {children}
      </Container>
    </group>
  )
}

interface PanelTextProps {
  children: ReactNode
  size?: number
  color?: number
}

export function PanelText({ children, size = 17, color = 0x172033 }: PanelTextProps) {
  return (
    <Text fontSize={size} color={color} textAlign="center" fontFamily="ja">
      {children}
    </Text>
  )
}

interface ActionButtonProps {
  id: string
  label: string
  detail?: string
  interactionText: string
  onInteract: () => void
  position?: [number, number, number]
  width?: number
  height?: number
  color?: string
  enabled?: boolean
}

export function ActionButton({
  id,
  label,
  detail,
  interactionText,
  onInteract,
  position = [0, 0, 0],
  width = 1.35,
  height = 0.48,
  color = '#146c94',
  enabled = true,
}: ActionButtonProps) {
  const fontFamilies = useDefaultFont(['ja'])

  return (
    <group position={position}>
      <Interactable
        id={id}
        enabled={enabled}
        interactionText={interactionText}
        onInteract={onInteract}
      >
        <group>
          <mesh castShadow>
            <boxGeometry args={[width, height, 0.12]} />
            <meshStandardMaterial
              color={enabled ? color : '#9aa3af'}
              emissive={enabled ? color : '#667085'}
              emissiveIntensity={enabled ? 0.22 : 0.04}
              roughness={0.55}
            />
          </mesh>
          <group position={[0, 0, 0.065]}>
            <Container
              sizeX={width}
              sizeY={height}
              pixelSize={0.01}
              justifyContent="center"
              alignItems="center"
              flexDirection="column"
              gap={2}
              fontFamilies={fontFamilies}
            >
              <Text fontSize={15} color={0xffffff} textAlign="center" fontFamily="ja">
                {label}
              </Text>
              {detail ? (
                <Text fontSize={8} color={0xe5f5ff} textAlign="center" fontFamily="ja">
                  {detail}
                </Text>
              ) : null}
            </Container>
          </group>
        </group>
      </Interactable>
    </group>
  )
}

interface TextInputActionButtonProps {
  id: string
  label: string
  detail?: string
  interactionText: string
  placeholder: string
  initialValue?: string
  maxLength: number
  onSubmit: (value: string) => void
  position?: [number, number, number]
  width?: number
  height?: number
  color?: string
  enabled?: boolean
}

export function TextInputActionButton({
  id,
  label,
  detail,
  interactionText,
  placeholder,
  initialValue,
  maxLength,
  onSubmit,
  position = [0, 0, 0],
  width = 1.65,
  height = 0.48,
  color = '#0f766e',
  enabled = true,
}: TextInputActionButtonProps) {
  const fontFamilies = useDefaultFont(['ja'])

  return (
    <group position={position}>
      <TextInput
        id={id}
        value={initialValue}
        placeholder={placeholder}
        maxLength={maxLength}
        onSubmit={onSubmit}
        interactionText={interactionText}
        disabled={!enabled}
      >
        <group>
          <mesh castShadow>
            <boxGeometry args={[width, height, 0.12]} />
            <meshStandardMaterial
              color={enabled ? color : '#9aa3af'}
              emissive={enabled ? color : '#667085'}
              emissiveIntensity={enabled ? 0.22 : 0.04}
              roughness={0.55}
            />
          </mesh>
          <group position={[0, 0, 0.065]}>
            <Container
              sizeX={width}
              sizeY={height}
              pixelSize={0.01}
              justifyContent="center"
              alignItems="center"
              flexDirection="column"
              gap={2}
              fontFamilies={fontFamilies}
            >
              <Text fontSize={12} color={0xffffff} textAlign="center" fontFamily="ja">
                {label}
              </Text>
              {detail ? (
                <Text fontSize={7} color={0xe5f5ff} textAlign="center" fontFamily="ja">
                  {detail}
                </Text>
              ) : null}
            </Container>
          </group>
        </group>
      </TextInput>
    </group>
  )
}
