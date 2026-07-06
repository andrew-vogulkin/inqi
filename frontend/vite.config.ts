import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT override lets tooling (previews, parallel checkouts) assign a port; plain `pnpm dev` stays on 5173.
    port: Number(process.env.PORT) || 5173,
    proxy: { '/api': 'http://localhost:4000', '/socket.io': { target: 'http://localhost:4000', ws: true } },
  },
});
