// Intents.swift — App Intents：完成一组 / 重置秒表 / 下一个动作 / 开始训练。
// 在快捷指令 App 里能直接用，可以绑到"轻点背面"、动作按钮，或者对 Siri 说。
// 命令交给 Bridge：网页活着就立刻执行，App 被杀了就排队，下次打开按原时间戳补记（秒表才准）。
import AppIntents

struct CompleteSetIntent: AppIntent {
    static var title: LocalizedStringResource = "完成一组"
    static var description = IntentDescription("给训练页里进行中的动作记一组（按预填的重量和次数），秒表重新开始。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        Bridge.shared.deliver(command: "completeSet")
        let state = AppState.shared
        if state.inTraining, let ex = state.activeExercise {
            return .result(dialog: "已给\(ex)记一组")
        }
        return .result(dialog: "没有进行中的动作，打开 App 看看")
    }
}

struct ResetRestIntent: AppIntent {
    static var title: LocalizedStringResource = "重置秒表"
    static var description = IntentDescription("组间秒表从现在重新计时。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        Bridge.shared.deliver(command: "resetRest")
        return .result(dialog: "秒表已重置")
    }
}

struct NextExerciseIntent: AppIntent {
    static var title: LocalizedStringResource = "下一个动作"
    static var description = IntentDescription("切到训练页里下一个待做的动作。")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        Bridge.shared.deliver(command: "nextExercise")
        return .result(dialog: "已切到下一个动作")
    }
}

struct StartTrainingIntent: AppIntent {
    static var title: LocalizedStringResource = "开始训练"
    static var description = IntentDescription("打开 App 进入今天的训练。")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        Bridge.shared.deliver(command: "startTraining")
        return .result()
    }
}

// 让这几个动作直接出现在快捷指令 App 的"App 快捷指令"里，并且能用 Siri 叫（中英文各一句）
struct WorkoutShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CompleteSetIntent(),
            phrases: ["\(.applicationName) 完成一组", "用 \(.applicationName) 记一组", "Log a set in \(.applicationName)"],
            shortTitle: "完成一组",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: ResetRestIntent(),
            phrases: ["\(.applicationName) 重置秒表", "Reset rest timer in \(.applicationName)"],
            shortTitle: "重置秒表",
            systemImageName: "arrow.counterclockwise"
        )
        AppShortcut(
            intent: NextExerciseIntent(),
            phrases: ["\(.applicationName) 下一个动作", "Next exercise in \(.applicationName)"],
            shortTitle: "下一个动作",
            systemImageName: "arrow.right.circle"
        )
        AppShortcut(
            intent: StartTrainingIntent(),
            phrases: ["\(.applicationName) 开始训练", "Start training in \(.applicationName)"],
            shortTitle: "开始训练",
            systemImageName: "figure.strengthtraining.traditional"
        )
    }
}
