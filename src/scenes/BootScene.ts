import Phaser from 'phaser'
import { saveManager } from '../systems/SaveManager'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    // Load local save into memory before any scene reads progress.
    saveManager.load()
    this.scene.start('Preload')
  }
}
