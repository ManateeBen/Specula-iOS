import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    private let supportedImportExtensions = ["epub"]

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if handleImportedDocument(url) {
            return true
        }

        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func handleImportedDocument(_ url: URL) -> Bool {
        let fileExtension = url.pathExtension.lowercased()
        guard supportedImportExtensions.contains(fileExtension) else {
            return false
        }

        let didAccessResource = url.startAccessingSecurityScopedResource()
        defer {
            if didAccessResource {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let fileManager = FileManager.default
            let dataDirectory = try fileManager.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let importsDirectory = dataDirectory.appendingPathComponent("ExternalImports", isDirectory: true)
            try fileManager.createDirectory(at: importsDirectory, withIntermediateDirectories: true)

            let fileName = "\(UUID().uuidString).\(fileExtension)"
            let destination = importsDirectory.appendingPathComponent(fileName)
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }
            try fileManager.copyItem(at: url, to: destination)

            var components = URLComponents()
            components.scheme = "specula"
            components.host = "import"
            components.queryItems = [
                URLQueryItem(name: "path", value: "ExternalImports/\(fileName)"),
                URLQueryItem(name: "name", value: url.lastPathComponent)
            ]

            if let importURL = components.url {
                _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: importURL, options: [:])
            }
            return true
        } catch {
            NSLog("Specula failed to import shared document: \(error.localizedDescription)")
            return false
        }
    }

}
