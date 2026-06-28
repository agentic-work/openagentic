import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { createRequire } from 'module'

// Canonical app version: the build arg (VITE_APP_VERSION / APP_VERSION) wins,
// otherwise fall back to this service's package.json version (1.0.0) instead of
// a stray dev sentinel — so the About modal always shows a real release number.
const pkg = createRequire(import.meta.url)('./package.json') as { version?: string }
const APP_VERSION = process.env.VITE_APP_VERSION || process.env.APP_VERSION || pkg.version || '1.0.0'

// https://vitejs.dev/config/
export default defineConfig({
  // Tailwind v4 CSS-first: the @tailwindcss/vite plugin processes the
  // `@import "tailwindcss"` + `@theme` SOT in src/styles/theme.css. This
  // replaces the v3 PostCSS `tailwindcss` plugin (now removed from
  // postcss.config.js; autoprefixer stays for vendor prefixing).
  plugins: [tailwindcss(), react()],
  // Serve public folder (includes docs)
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/app': path.resolve(__dirname, './src/app'),
      '@/features': path.resolve(__dirname, './src/features'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/api': path.resolve(__dirname, './src/api'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/config': path.resolve(__dirname, './src/config'),
      '@/assets': path.resolve(__dirname, './src/assets')
    }
  },
  define: {
    // Environment-specific builds
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    '__APP_VERSION__': JSON.stringify(APP_VERSION)
  },
  build: {
    // Production optimizations
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
    target: 'esnext',
    cssMinify: true,
    rollupOptions: {
      output: {
        // Enhanced code splitting for better caching
        manualChunks: {
          // Core React ecosystem
          'react-vendor': ['react', 'react-dom'],
          'react-router': ['react-router-dom'],

          // Heavy UI libraries
          'ui-vendor': ['framer-motion'],
          'icons': ['lucide-react'],

          // Chat-specific heavy components (lazy loaded)
          'admin-portal': ['@/features/admin/components/Shell/AdminPortalHost'],
          'image-analysis': ['@/shared/components/ImageAnalysis'],
          'docs-viewer': ['@/features/docs/DocsViewer'],
          'canvas-panel': ['@/shared/components/CanvasPanel']
        },
        // Better file naming for caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    // Chunk size warnings
    chunkSizeWarningLimit: 1000
  },
  optimizeDeps: {
    // Pre-bundle heavy dependencies for faster cold starts
    include: [
      'react-markdown',
      'remark-gfm',
      'framer-motion',
      'lucide-react'
    ],
    // Exclude heavy components that are lazy loaded
    exclude: [
      '@/features/admin/components/Shell/AdminPortalHost',
      '@/shared/components/ImageAnalysis',
      '@/features/docs/DocsViewer',
      '@/shared/components/CanvasPanel'
    ],
    esbuildOptions: {
      target: 'esnext',
      // Enable tree shaking
      treeShaking: true
    }
  },
  server: {
    host: true,
    port: 3000,
    // Performance optimizations
    hmr: {
      overlay: false // Disable error overlay for better performance
    },
    // Enable HTTP/2 for development
    https: false, // Can be enabled with certificates
    // Faster file watching
    watch: {
      usePolling: false,
      useFsEvents: true
    },
    // Allow all hosts for development (including k3s service names and custom dev domains)
    allowedHosts: true,
    proxy: {
      '/api': {
        // Use K3S_API_URL for k3s dev server, or fallback to localhost for local dev
        target: process.env.K3S_API_URL || (process.env.DOCKER_ENV ? 'http://openagentic-api:8000' : 'http://localhost:8000'),
        changeOrigin: true,
        // Present an allowed Origin to the backend so its CORS allowlist accepts
        // requests from the local dev server (DEV_ORIGIN env, e.g. the deployed
        // host) — otherwise login 500s with "Not allowed by CORS".
        headers: process.env.DEV_ORIGIN ? { origin: process.env.DEV_ORIGIN } : undefined,
        // Note: Don't strip /api prefix - the API server expects routes at /api/*
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/ws': {
        target: process.env.K3S_API_URL?.replace('http://', 'ws://') || (process.env.DOCKER_ENV ? 'ws://openagentic-api:8000' : 'ws://localhost:8000'),
        ws: true,
        changeOrigin: true,
        // Note: Don't strip /ws prefix - the API server expects routes at /ws/*
        // rewrite: (path) => path.replace(/^\/ws/, '')
      }
    }
  }
})
