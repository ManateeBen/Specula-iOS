import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.specula.reader',
  appName: 'Specula',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
