import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { version } from './package.json';

export default defineConfig({
  // Shown in Profile > About.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Forge OS, athlete assistant',
        short_name: 'Forge OS',
        description: 'Personal AI athlete assistant for HYROX, running, strength, nutrition and recovery.',
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // In dev/preview, forward /api to the local coach server (npm run server).
  server: { host: true, port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    rollupOptions: {
      output: {
        // Heavy libraries get their own chunks, so app updates don't re-download them.
        manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom', 'idb'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
});
