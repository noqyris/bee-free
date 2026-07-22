import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    // Nothing external to configure yet (M1). Save/analytics init lands here later.
    this.scene.start('Preload')
  }
}
