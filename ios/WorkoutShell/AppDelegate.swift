// AppDelegate.swift — 通知代理（前台也显示横幅；组间到点在前台交给 RestAlert 出声和震动）、回前台时通知网页重算秒表。
import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            Bridge.shared.send(["type": "foreground"])
        }
        return true
    }

    // App 在前台时通知也要出来。组间到点：声音和震动由 RestAlert 出（静音键打开也响），通知只显示横幅
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        if notification.request.identifier == Notifications.restId {
            RestAlert.fire(sound: notification.request.content.userInfo["sound"] as? Bool ?? false)
            return [.banner, .list]
        }
        return [.banner, .sound, .list]
    }

    // 点通知进 App：什么都不用做，网页收到 foreground 会重算
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    }
}
