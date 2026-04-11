import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['favicon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Sewa Samiti Barcode Scanner',
        short_name: 'SS Scanner',
        description: 'Sewa Samiti Barcode Scanner App',
        theme_color: '#8b0000',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/barcode-scanner/',
        scope: '/barcode-scanner/',
        icons: [
          {
            src: '/barcode-scanner/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/barcode-scanner/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\.(js|css|woff|woff2|ttf|eot|ico|png|jpg|jpeg|svg|gif)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ],
        navigateFallback: null,
        cleanupOutdatedCaches: true
      }
    })
  ],
  base: '/barcode-scanner/',
  resolve: {
    conditions: ['zbar-inlined'],
  },
})
