import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 serves over https on the network, so a phone gets the tilt sensors
export default defineConfig({
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(5, 16)) },
  plugins: process.env.HTTPS ? [basicSsl()] : [],
});
