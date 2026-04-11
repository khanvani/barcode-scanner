import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set base to your GitHub repo name, e.g. '/barcode-scanner/'
// Change 'barcode-scanner' to match your actual repo name.
export default defineConfig({
  plugins: [react()],
  base: '/barcode-scanner/',
  resolve: {
    // Required to pick up the inlined WASM build of zbar-wasm (no separate .wasm fetch)
    conditions: ['zbar-inlined'],
  },
})
