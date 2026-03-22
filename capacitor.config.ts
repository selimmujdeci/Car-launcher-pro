import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.carlauncher.pro',
  appName: 'Car Launcher Pro',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    captureInput: true,
    // Enable remote WebView debugging during launcher test (chrome://inspect)
    // Set to false for production release
    webContentsDebuggingEnabled: process.env['NODE_ENV'] !== 'production',
    backgroundColor: '#060d1a',
    loggingBehavior: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'none',
    initialFocus: false,
    appendUserAgent: 'CarLauncherPro/1.0',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
