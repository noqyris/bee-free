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
        CAPPluginMethod(name: "getEnvironment", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Transactions can also arrive outside a purchase call — Ask to Buy
        // approvals, purchases made on another device, refunds. Finishing them
        // here stops StoreKit from re-delivering them on every launch.
        updatesTask = Task.detached {
            for await update in Transaction.updates {
                if case .verified(let transaction) = update {
                    await transaction.finish()
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
                        await transaction.finish()
                        call.resolve(["status": "purchased", "productId": transaction.productID])
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

    /// Whether this build runs in the sandbox (TestFlight / Xcode) vs the App
    /// Store. TestFlight ships a receipt file named "sandboxReceipt"; the App
    /// Store ships "receipt". Ads use this to serve Google TEST ads on TestFlight
    /// and LIVE ads in production, from the same binary.
    @objc func getEnvironment(_ call: CAPPluginCall) {
        let isSandbox = Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        call.resolve(["sandbox": isSandbox])
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
