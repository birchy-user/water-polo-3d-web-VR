import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDev = mode === 'development';
  return {
    plugins: [
      ...(isDev ? [basicSsl()] : []),  // HTTPS ar "basicSsl" tikai "dev" serverī (uz lokālās ierīces), jo produkcijā jau ir HTTPS (Vercel)
      svelte()
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
  };
});