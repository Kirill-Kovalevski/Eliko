import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ❗ Use just the repository name here so GitHub Pages works:
export default defineConfig({
  plugins: [react()],
  base: '/Eliko/',       // <-- your repo name
})
