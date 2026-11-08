// AppState.swift — 网页同步过来的当前状态（训练中、进行中动作），给快捷指令的回话用。存 UserDefaults，App 被杀后也有。
import Foundation

final class AppState {
    static let shared = AppState()
    private let key = "webState"

    var inTraining: Bool { (stored["inTraining"] as? Bool) ?? false }
    var template: String? { stored["template"] as? String }
    var activeExercise: String? { stored["activeExercise"] as? String }
    var restRunning: Bool { (stored["restRunning"] as? Bool) ?? false }

    private var stored: [String: Any] {
        UserDefaults.standard.dictionary(forKey: key) ?? [:]
    }

    // 网页里的 null 过来是 NSNull，UserDefaults 存不了会崩；只留字符串 / 数字 / 布尔
    func update(from body: [String: Any]) {
        var dict: [String: Any] = [:]
        for (k, v) in body where k != "type" {
            switch v {
            case is String, is NSNumber: dict[k] = v
            default: continue
            }
        }
        UserDefaults.standard.set(dict, forKey: key)
    }
}
