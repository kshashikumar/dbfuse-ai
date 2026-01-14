import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import tsconfigPaths from 'vite-tsconfig-paths';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

// Vite config is used ONLY for production builds.
// For development, use Angular CLI: npm run start
export default defineConfig({
    base: './',
    plugins: [
        angular(),
        tsconfigPaths(),
        viteStaticCopy({
            targets: [
                // Copy static assets to dist
                { src: 'src/favicon.ico', dest: '.' },
                { src: 'src/assets', dest: '.' },
                // Copy Monaco Editor assets (required for code editor)
                {
                    src: 'node_modules/monaco-editor/min/vs',
                    dest: 'assets/monaco',
                },
            ],
        }),
    ],
    build: {
        target: 'esnext',
        outDir: resolve(__dirname, '../..', 'src', 'public'),
        emptyOutDir: true,
        sourcemap: false,
        // Increase chunk size warning limit for Monaco
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
            output: {
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
    },
    server: {
        port: 4201,
        open: false,
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                secure: false,
            },
        },
    },
    cacheDir: '.vite-cache',
});
