import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// ViteおよびPWA設定ファイル
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '御朱印めぐり - 神社仏閣マップ＆御朱印帳',
        short_name: '御朱印めぐり',
        description: '現在地周辺の神社・お寺を探して、自分だけのデジタル御朱印帳を作れる和モダンWebアプリ',
        theme_color: '#1a1a1a',
        background_color: '#fcfaf2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          {
            src: 'icon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // Google Maps タイルのキャッシュ設定
            urlPattern: /^https:\/\/mt[0-3]\.google\.com\/vt\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-map-tile-cache',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30日間保存
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // OpenStreetMapタイルのキャッシュ設定
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tile-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    open: true
  }
});
