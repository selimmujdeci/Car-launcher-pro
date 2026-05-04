import type { CapacitorConfig } from '@capacitor/cli';

// Default to production-safe values when NODE_ENV is not explicitly set.
// Run `NODE_ENV=development npx cap sync` for development builds.
const isDev = process.env['NODE_ENV'] === 'development';

const config: CapacitorConfig = {
  appId: 'com.cockpitos.pro',
  appName: 'Caros Pro',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#060d1a',
    loggingBehavior: isDev ? 'debug' : 'none',
    initialFocus: false,
    appendUserAgent: 'CarosPro/1.0',
  },
  server: {
    androidScheme: isDev ? 'http' : 'https',
  },
};

export default config;
