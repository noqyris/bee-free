import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.beefree.hiveescape',
  appName: 'Bee Free',
  webDir: 'dist',
  // Black, not the game's brown: this is the window behind the web view, and
  // the only moment it is ever visible is between the (black) launch screen
  // going away and the studio sting painting. Brown there was a flash.
  backgroundColor: '#000000',
  ios: {
    // The game canvas handles safe areas itself; let it fill the screen.
    contentInset: 'never',
    backgroundColor: '#000000',
  },
}

export default config
