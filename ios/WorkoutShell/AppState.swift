// AppState.swift — 网页同步过来的完整训练状态（docs/ios-app-plan.md 10.2）：快捷指令的回话用，以后手表显示、手机在后台时原生自己记组也靠它。
// 存 UserDefaults，App 被杀后也有。
import Foundation

final class AppState {
    static let shared = AppState()
    private let key = "webState"

    var inTraining: Bool { (stored["inTraining"] as? Bool) ?? false }
    var template: String? { stored["template"] as? String }
    var activeExercise: String? { stored["activeExercise"] as? String }
    var activeId: String? { stored["activeId"] as? String }
    var restRunning: Bool { (stored["restRunning"] as? Bool) ?? false }
    var restStartedAtMs: Double? { stored["restStartedAt"] as? Double }
    var restSeconds: Double? { stored["restSeconds"] as? Double }
    var exercises: [[String: Any]] { stored["exercises"] as? [[String: Any]] ?? [] }
    var today: String? { stored["today"] as? String }

    private var stored: [String: Any] {
        UserDefaults.standard.dictionary(forKey: key) ?? [:]
    }

    // 网页里的 null 过来是 NSNull，UserDefaults 存不了会崩；只留字符串 / 数字 / 布尔，数组和字典递归清理
    func update(from body: [String: Any]) {
        var dict: [String: Any] = [:]
        for (k, v) in body where k != "type" {
            if let safe = Self.plistSafe(v) { dict[k] = safe }
        }
        UserDefaults.standard.set(dict, forKey: key)
    }

    private static func plistSafe(_ v: Any) -> Any? {
        switch v {
        case is NSNull:
            return nil
        case is String, is NSNumber:
            return v
        case let arr as [Any]:
            return arr.compactMap { plistSafe($0) }
        case let dict as [String: Any]:
            var out: [String: Any] = [:]
            for (k, x) in dict {
                if let y = plistSafe(x) { out[k] = y }
            }
            return out
        default:
            return nil
        }
    }
}
