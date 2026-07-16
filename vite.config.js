import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        xg: resolve(__dirname, 'xg.html'),
        datalytics: resolve(__dirname, 'datalytics.html'),
      },
    },
  },
});
