import UIKit
import Capacitor

/**
 * Registers our app-target StoreKit plugin with the Capacitor bridge.
 *
 * Capacitor 6+ only auto-discovers plugins that ship as Swift Package / CocoaPods
 * *packages* — it no longer scans the app target for `CAPBridgedPlugin` classes.
 * So `StoreKitBridgePlugin` (a plain file in this target) was never registered,
 * and every StoreKit call failed with `"StoreKitBridge" plugin is not implemented
 * on ios` — which surfaced as "Purchase failed" for players and App Review alike.
 *
 * Registering the instance here is the documented fix; Main.storyboard points its
 * bridge view controller at this subclass.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StoreKitBridgePlugin())
    }
}
