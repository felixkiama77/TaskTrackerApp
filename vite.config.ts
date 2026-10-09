import { defineConfig, type Plugin } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'

const DEV_PORT = 5173

/**
 * Content Security Policy for the renderer. The built app allows only its own files; development
 * also allows Vite's injected styles and its live-reload connection.
 */
function contentSecurityPolicy(): Plugin {
  let dev = false
  return {
    name: 'task-tracker-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml() {
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
        "img-src 'self' data:",
        "media-src 'self' tt-sound:",
        "font-src 'self'",
        dev ? `connect-src 'self' ws://localhost:${DEV_PORT}` : "connect-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "manifest-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ')
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // Relative asset paths so the built page works when loaded from file://.
  base: './',
  // A fixed port keeps the dev page's origin stable; data saved by the old version lives under it.
  server: { port: DEV_PORT, strictPort: true },
  build: {
    // Never inline audio as data: URIs; the security policy only allows the app's own files.
    assetsInlineLimit: (file: string) => (/\.(mp3|ogg|wav|m4a)$/i.test(file) ? false : undefined),
  },
  plugins: [
    contentSecurityPolicy(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
      },
      preload: {
        input: path.join(import.meta.dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rolldownOptions: {
              // Sandboxed preload scripts cannot be ES modules, so emit CommonJS.
              output: { format: 'cjs', entryFileNames: '[name].cjs' },
            },
          },
        },
      },
    }),
  ],
})
