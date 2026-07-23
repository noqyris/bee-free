import Phaser from 'phaser'
import { adService } from '../systems/AdService'
import { purchaseService } from '../systems/PurchaseService'
import { saveManager } from '../systems/SaveManager'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    // Load local save into memory before any scene reads progress.
    saveManager.load()

    // Monetization warms up in the background — it must never delay or block
    // the player getting to the game, and it is inert on web.
    // Purchases first: a restored "remove ads" entitlement suppresses ad setup.
    void purchaseService.init().then(() => adService.init())

    this.scene.start('Preload')
  }
}
