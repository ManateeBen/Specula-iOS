import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.specula.reader',
  appName: 'Specula',
  webDir: 'dist',
  ios: {
    // The app handles the status bar and home-indicator safe areas in CSS.
    // Automatic insets can leave an uncovered strip below the WebView.
    contentInset: 'never',
    scrollEnabled: true,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
