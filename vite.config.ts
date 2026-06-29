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
      host: process.env.HOST || '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true' ? {
        port: parseInt(process.env.HMR_PORT || "24678", 10),
      } : false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Use a function so chokidar reliably excludes these paths on Windows
        // (glob patterns fail on backslash-separated Windows paths).
        ignored: (filePath: string) => {
          const normalized = filePath.replace(/\\/g, '/');
          return (
            normalized.endsWith('/db.json') ||
            normalized.endsWith('/logs.db') ||
            normalized.endsWith('/logs.db-wal') ||
            normalized.endsWith('/logs.db-shm') ||
            normalized.includes('/sandbox_workspaces/') ||
            normalized.includes('/.claude/') ||
            normalized.endsWith('.test.ts') ||
            normalized.endsWith('.spec.ts') ||
            normalized.includes('/test/')
          );
        },
      },
    },
  };
});
