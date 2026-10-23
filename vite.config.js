import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 serves over https on the network, so a phone gets the tilt sensors
export default defineConfig({
  plugins: process.env.HTTPS ? [basicSsl()] : [],
});
