import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Use a function so chokidar reliably excludes these paths on Windows
        // (glob patterns fail on backslash-separated Windows paths).
        ignored: (filePath: string) => {
          const normalized = filePath.replace(/\\/g, '/');
          return (
            normalized.endsWith('/db.json') ||
            normalized.includes('/sandbox_workspaces/')
          );
        },
      },
    },
  };
});
