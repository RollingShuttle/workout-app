// Notifications.swift — 本地通知：组间休息到点（一条，id "rest"）和训练日提醒（每天一条，id "reminder-日期"）。
// 时间按网页给的时间戳排，不依赖后台 JS，App 被杀也准。
import Foundation
import UserNotifications

final class Notifications {
    private let center = UNUserNotificationCenter.current()
    private static let restId = "rest"
    private static let reminderPrefix = "reminder-"

    // 第一次用到时才申请权限（在"完成一组"的手势之后，不在启动时）
    private func ensureAuthorized(_ then: @escaping (Bool) -> Void) {
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                self.center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    Bridge.shared.send(["type": "notification.permission", "granted": granted])
                    then(granted)
                }
            case .denied:
                then(false)
            default:
                then(true)
            }
        }
    }

    func scheduleRest(atMs: Double, title: String, body: String, sound: Bool) {
        cancelRest()
        let interval = atMs / 1000 - Date().timeIntervalSince1970
        guard interval >= 1 else { return } // 已经到了就不发
        ensureAuthorized { granted in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            if sound { content.sound = .default }
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            self.center.add(UNNotificationRequest(identifier: Self.restId, content: content, trigger: trigger))
        }
    }

    func cancelRest() {
        center.removePendingNotificationRequests(withIdentifiers: [Self.restId])
        center.removeDeliveredNotifications(withIdentifiers: [Self.restId])
    }

    // items: [{ id, date: "YYYY-MM-DD", hour, minute, title, body }]。同一天的 id 相同，add 会覆盖；不在列表里的删掉
    func setReminders(_ items: [[String: Any]]) {
        let wanted = Set(items.compactMap { ($0["date"] as? String).map { Self.reminderPrefix + $0 } })
        center.getPendingNotificationRequests { requests in
            let stale = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) && !wanted.contains($0) }
            if !stale.isEmpty { self.center.removePendingNotificationRequests(withIdentifiers: stale) }
            guard !items.isEmpty else { return }
            self.ensureAuthorized { granted in
                guard granted else { return }
                for item in items {
                    guard let date = item["date"] as? String, let hour = item["hour"] as? Int, let minute = item["minute"] as? Int else { continue }
                    let parts = date.split(separator: "-").compactMap { Int($0) }
                    guard parts.count == 3 else { continue }
                    var comps = DateComponents()
                    comps.year = parts[0]
                    comps.month = parts[1]
                    comps.day = parts[2]
                    comps.hour = hour
                    comps.minute = minute
                    let content = UNMutableNotificationContent()
                    content.title = item["title"] as? String ?? "今天练什么"
                    content.body = item["body"] as? String ?? ""
                    content.sound = .default
                    let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                    self.center.add(UNNotificationRequest(identifier: Self.reminderPrefix + date, content: content, trigger: trigger))
                }
            }
        }
    }
}
