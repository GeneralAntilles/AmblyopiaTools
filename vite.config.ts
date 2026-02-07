import { defineConfig } from 'vite';
import { resolve } from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    basicSsl(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    // WebXR requires secure context — self-signed cert via basicSsl plugin
    // Quest Browser will show a certificate warning once; accept it to proceed
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
