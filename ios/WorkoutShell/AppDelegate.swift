// AppDelegate.swift — 通知代理（前台也显示横幅和声音）、回前台时通知网页重算秒表。
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

    // App 在前台时组间通知也要出来（横幅 + 声音 + 通知中心），这就是"组间提示音"
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        return [.banner, .sound, .list]
    }

    // 点通知进 App：什么都不用做，网页收到 foreground 会重算
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    }
}
