import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    // WebXR requires secure context; Quest Browser allows http to local IPs
    // For production, use HTTPS
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
