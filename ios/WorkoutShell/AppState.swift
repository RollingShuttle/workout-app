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

    func update(from body: [String: Any]) {
        var dict: [String: Any] = [:]
        for (k, v) in body where k != "type" { dict[k] = v }
        UserDefaults.standard.set(dict, forKey: key)
    }
}
