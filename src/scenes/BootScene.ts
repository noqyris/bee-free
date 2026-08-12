import Phaser from 'phaser'
import { adService } from '../systems/AdService'
import { purchaseService } from '../systems/PurchaseService'
import { saveManager } from '../systems/SaveManager'
import { isSandboxBuild } from '../systems/appEnv'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    // Load the local save into memory — and on native, reconcile it with the
    // Preferences mirror (iOS can purge WKWebView localStorage; the mirror is
    // what keeps bought power-ups and progress alive) — before any scene reads
    // progress. hydrate() resolves instantly on web.
    // TestFlight builds unlock every level. Resolved here, before any scene
    // reads progress, and deliberately NOT awaited into the boot path — the
    // Menu re-reads unlock state when it opens, and a slow native round trip
    // must never hold the player at a black screen.
    void isSandboxBuild().then((sandbox) => saveManager.setTestFlightUnlock(sandbox))
    void saveManager.hydrate().finally(() => {
      // Monetization warms up in the background — it must never delay or block
      // the player getting to the game, and it is inert on web.
      // Purchases first: a restored "remove ads" entitlement suppresses ad setup.
      void purchaseService.init().then(() => adService.init())
      this.scene.start('Preload')
    })
  }
}
