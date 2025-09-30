import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⛳ IMPORTANT: this *must* match your repo name EXACTLY (case-sensitive)
export default defineConfig({
  plugins: [react()],
  base: '/Eliko/',   // <-- if the repo is "Eliko". If your repo is "eliko", change to '/eliko/'
})
