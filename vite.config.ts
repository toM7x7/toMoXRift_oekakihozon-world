import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
    }),
    federation({
      name: 'xrift_pen_memory_gallery',
      filename: 'remoteEntry.js',
      exposes: {
        './World': './src/index.tsx',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '*',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '*',
        },
        'react-dom/client': {
          singleton: true,
        },
        'react/jsx-runtime': {
          singleton: true,
        },
        three: {
          singleton: true,
          requiredVersion: '*',
        },
        'three/addons/loaders/DRACOLoader.js': {
          singleton: true,
        },
        '@react-three/fiber': {
          singleton: true,
          requiredVersion: '*',
        },
        '@react-three/rapier': {
          singleton: true,
          requiredVersion: '*',
        },
        '@react-three/drei': {
          singleton: true,
          requiredVersion: '*',
        },
        '@react-three/uikit': {
          singleton: true,
          requiredVersion: '*',
        },
        '@xrift/world-components': {
          singleton: true,
          requiredVersion: '*',
        },
      },
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    assetsDir: '',
  },
  resolve: {
    // file:で接続したDcPen forkもワールド側のsingletonを使い、React/Threeの二重化を防ぐ。
    dedupe: [
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
      '@react-three/drei',
      '@react-three/rapier',
      '@xrift/world-components',
    ],
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },
  define: {
    global: 'globalThis',
  },
})
