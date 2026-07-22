import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.beefree.hiveescape',
  appName: 'Bee Free',
  webDir: 'dist',
  backgroundColor: '#140d06',
  ios: {
    // The game canvas handles safe areas itself; let it fill the screen.
    contentInset: 'never',
    backgroundColor: '#140d06',
  },
}

export default config
