import { defineConfig } from 'vite';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless'
};

export default defineConfig({
  base: './',
  // Workers are ES modules (the lyrics worker lazy-loads the Whisper model).
  worker: { format: 'es' },
  // Same cross-origin isolation headers as netlify.toml, so local dev/preview gets multi-threading too.
  server: { headers: isolation },
  preview: { headers: isolation },
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap:
      process.env.APPDEPLOY_VITE_SOURCEMAP === 'hidden' ? 'hidden' : false,
    rollupOptions: {
      maxParallelFileOps: 128,
    },
  },
});
