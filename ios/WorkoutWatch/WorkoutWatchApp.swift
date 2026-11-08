// WorkoutWatchApp.swift — 手表端入口（docs/ios-app-plan.md 10.2）。手表只是遥控器 + 显示屏，手机 App 是唯一真相。
// 第 3 步：先只显示一页，验证 target 能装到真手表；第 4 步接 WCSession 显示训练状态。
import SwiftUI

@main
struct WorkoutWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
