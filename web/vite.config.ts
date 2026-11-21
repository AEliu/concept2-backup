import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/concept2-backup/',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        manifest: {
          name: 'Rowing Stats Visualizer',
          short_name: 'RowingStats',
          description: 'Concept2 training volume, activity calendar, and workout details',
          theme_color: '#f3f3f1',
          background_color: '#f3f3f1',
          display: 'standalone',
          scope: '/concept2-backup/',
          start_url: '/concept2-backup/',
          orientation: 'portrait-primary',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            }
          ],
          screenshots: [
            {
              src: 'screenshot-desktop.png',
              sizes: '1280x1180',
              type: 'image/png',
              form_factor: 'wide', // 标记为宽屏设备用
              label: 'Desktop Dashboard'
            },
            {
              src: 'screenshot-mobile.png',
              sizes: '780x1688',
              type: 'image/png',
              label: 'Mobile View'
            }
          ]
        },
        workbox: {
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 365 days
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 365 days
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /\/activities\/index\.json$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'activity-index-cache',
                expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 7 }
              }
            },
            {
              urlPattern: /\/activities\/details\/[1-9]\d*\.json$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'activity-detail-cache',
                expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 7 }
              }
            },
            {
              urlPattern: /\/stats\.json$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'stats-data-cache',
                expiration: {
                  maxEntries: 5,
                  maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
                }
              }
            }
          ]
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
