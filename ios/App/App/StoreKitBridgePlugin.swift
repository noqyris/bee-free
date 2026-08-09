import Foundation
import Capacitor
import StoreKit

/**
 * Self-contained StoreKit 2 bridge — no third-party purchase service.
 *
 * The game sells exactly one non-consumable ("remove ads"), which StoreKit 2
 * models well on its own: `Transaction.currentEntitlements` is the source of
 * truth for ownership (it survives reinstalls and syncs across the user's
 * devices), so there is no receipt parsing or server component to get wrong.
 *
 * Every method resolves rather than rejects for ordinary outcomes (cancelled,
 * pending) so the JS layer can treat those as flow, not as errors.
 */
@objc(StoreKitBridgePlugin)
public class StoreKitBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitBridgePlugin"
    public let jsName = "StoreKitBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getOwned", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEnvironment", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Transactions can also arrive outside a purchase call — Ask to Buy
        // approvals, purchases the app was killed during, purchases made on
        // another device. CRITICAL delivery contract: a transaction is only
        // finish()ed AFTER the JS layer confirms it granted the goods
        // (finishTransaction below). finish() permanently consumes it — if we
        // finished here and the webview had not registered its listener yet
        // (app cold start replays unfinished transactions immediately), the
        // player would be charged and never receive the consumable. Unfinished
        // transactions survive relaunches, and the JS grant ledger dedupes any
        // redelivery, so nothing is ever double-granted.
        // Revoked (refunded) transactions ARE finished here — no grant, no ack.
        updatesTask = Task.detached { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let transaction) = update {
                    if transaction.revocationDate == nil {
                        self?.notifyListeners("transactionUpdated", data: [
                            "productId": transaction.productID,
                            "transactionId": String(transaction.id)
                        ])
                    } else {
                        await transaction.finish()
                    }
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        guard let ids = call.getArray("productIds", String.self), !ids.isEmpty else {
            call.reject("productIds is required")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve([
                    "products": products.map { product in
                        [
                            "id": product.id,
                            "title": product.displayName,
                            "description": product.description,
                            "price": product.displayPrice
                        ]
                    }
                ])
            } catch {
                call.reject("Failed to load products: \(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("productId is required")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.resolve(["status": "failed", "message": "Unknown product \(productId)"])
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        // NOT finished here: the JS layer grants the goods,
                        // persists them, then calls finishTransaction. If the
                        // app dies in between, the unfinished transaction is
                        // redelivered next launch (getPendingTransactions /
                        // Transaction.updates) and the grant ledger dedupes.
                        call.resolve([
                            "status": "purchased",
                            "productId": transaction.productID,
                            "transactionId": String(transaction.id)
                        ])
                    case .unverified:
                        // Signature check failed — never grant on this.
                        call.resolve(["status": "failed", "message": "Purchase could not be verified"])
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // e.g. Ask to Buy awaiting a parent's approval.
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "failed", "message": "Unknown purchase result"])
                }
            } catch {
                call.resolve(["status": "failed", "message": error.localizedDescription])
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            // Prompts for the App Store password when needed; a cancelled sign-in
            // is not an error, we just report whatever is already entitled.
            try? await AppStore.sync()
            call.resolve(["ownedProductIds": await Self.ownedProductIds()])
        }
    }

    @objc func getOwned(_ call: CAPPluginCall) {
        Task {
            call.resolve(["ownedProductIds": await Self.ownedProductIds()])
        }
    }

    /// Verified, non-revoked transactions that were never finished — i.e. paid
    /// value the JS layer has not yet confirmed delivering. Called on startup
    /// (after the JS grant listener is live) so the cold-start window can never
    /// swallow a purchase.
    @objc func getPendingTransactions(_ call: CAPPluginCall) {
        Task {
            var pending: [[String: String]] = []
            for await entry in Transaction.unfinished {
                if case .verified(let transaction) = entry, transaction.revocationDate == nil {
                    pending.append([
                        "productId": transaction.productID,
                        "transactionId": String(transaction.id)
                    ])
                }
            }
            call.resolve(["transactions": pending])
        }
    }

    /// The JS layer's delivery acknowledgement: the goods are granted and
    /// persisted, so the transaction may now be consumed.
    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId") else {
            call.reject("transactionId is required")
            return
        }
        Task {
            for await entry in Transaction.unfinished {
                if case .verified(let transaction) = entry,
                   String(transaction.id) == transactionId {
                    await transaction.finish()
                    break
                }
            }
            call.resolve()
        }
    }

    /// Whether this build runs in the sandbox (TestFlight / Xcode) vs the App
    /// Store. Ads use this to serve Google TEST ads on TestFlight and LIVE ads in
    /// production, from the same binary.
    ///
    /// The authoritative signal is StoreKit 2's AppTransaction, which reports the
    /// environment from first launch. We fall back to the receipt-file name, and
    /// crucially treat ANYTHING that is not the production "receipt" (including a
    /// nil/undownloaded receipt on a fresh TestFlight install) as sandbox — the old
    /// `== "sandboxReceipt"` check returned false for nil, so a fresh TestFlight
    /// build wrongly showed LIVE ads (which then failed to fill).
    @objc func getEnvironment(_ call: CAPPluginCall) {
        Task {
            if #available(iOS 16.0, *) {
                do {
                    let result = try await AppTransaction.shared
                    if case .verified(let appTx) = result {
                        let env = "\(appTx.environment)".lowercased()
                        call.resolve(["sandbox": env.contains("sandbox") || env.contains("xcode")])
                        return
                    }
                } catch {
                    // Fall through to the receipt heuristic below.
                }
            }
            let isSandbox = Bundle.main.appStoreReceiptURL?.lastPathComponent != "receipt"
            call.resolve(["sandbox": isSandbox])
        }
    }

    /// Non-consumables this Apple ID currently owns, excluding revoked/refunded ones.
    private static func ownedProductIds() async -> [String] {
        var owned: [String] = []
        for await entitlement in Transaction.currentEntitlements {
            if case .verified(let transaction) = entitlement, transaction.revocationDate == nil {
                owned.append(transaction.productID)
            }
        }
        return owned
    }
}
