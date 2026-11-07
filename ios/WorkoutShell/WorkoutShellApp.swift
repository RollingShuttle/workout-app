// WorkoutShellApp.swift — App 入口：一个铺满屏幕的 WKWebView 承载仓库根目录的网页；原生只做通知、快捷指令、分享。
// 协议和实施步骤见 ../../docs/ios-app-plan.md
import SwiftUI

@main
struct WorkoutShellApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            WebContainerView()
                .ignoresSafeArea() // 网页自己用 env(safe-area-inset-*) 留边（viewport-fit=cover）
                .background(Color(UIColor.systemBackground))
        }
    }
}
