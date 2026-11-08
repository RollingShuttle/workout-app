// Bridge.swift — 网页 ↔ 原生的消息路由。协议见 docs/ios-app-plan.md 3.4。
// 网页 → 原生：window.webkit.messageHandlers.native.postMessage({ type, ... })
// 原生 → 网页：window.nativeEvent({ type, ... })
import WebKit
import UIKit

final class Bridge: NSObject, WKScriptMessageHandler {
    static let shared = Bridge()
    static let version = "1.0"
    static let caps = ["notifications", "intents", "haptics", "keepAwake", "share", "import", "backup"]

    private weak var webView: WKWebView?
    private var webReady = false
    private let notifications = Notifications()

    func attach(_ webView: WKWebView) {
        self.webView = webView
        webReady = false
    }

    // MARK: 网页 → 原生

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "native", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            webReady = true
            send(["type": "hello", "version": Self.version, "caps": Self.caps])
            flushQueuedCommands()

        case "restTimer.set":
            guard let at = body["at"] as? Double else { return }
            notifications.scheduleRest(atMs: at, title: body["title"] as? String ?? "休息到了", body: body["body"] as? String ?? "", sound: body["sound"] as? Bool ?? false)

        case "restTimer.clear":
            notifications.cancelRest()

        case "restTimer.fire": // 网页的秒表在前台走到参考时长（和前台到点的通知在 RestAlert 里去重）
            RestAlert.fire(sound: body["sound"] as? Bool ?? false)

        case "reminders.set":
            notifications.setReminders(body["items"] as? [[String: Any]] ?? [])

        case "reminders.clear":
            notifications.setReminders([])

        case "keepAwake":
            UIApplication.shared.isIdleTimerDisabled = body["on"] as? Bool ?? false

        case "haptic":
            Haptics.play(body["kind"] as? String ?? "light")

        case "export":
            guard let name = body["name"] as? String, let json = body["json"] as? String else { return }
            Share.exportJSON(name: name, json: json)

        case "import":
            FileImport.pick { [weak self] name, text in
                self?.send(["type": "import.result", "name": name, "text": text])
            }

        case "backup.save":
            guard let name = body["name"] as? String, let json = body["json"] as? String else { return }
            BackupStore.save(name: name, json: json)

        case "backup.load":
            if let b = BackupStore.latest() {
                send(["type": "backup.result", "name": b.name, "text": b.text, "savedAt": b.savedAtMs])
            } else {
                send(["type": "backup.result", "none": true])
            }

        case "state":
            AppState.shared.update(from: body)

        default:
            break
        }
    }

    // MARK: 原生 → 网页

    func send(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.nativeEvent(\(json))", completionHandler: nil)
        }
    }

    // 快捷指令 / Siri 发来的命令：网页活着就直接给，否则排队，等网页 ready 了连时间戳一起补发
    func deliver(command: String, at: Date = Date()) {
        let atMs = at.timeIntervalSince1970 * 1000
        if webReady, webView != nil {
            send(["type": "command", "name": command, "at": atMs])
        } else {
            CommandQueue.enqueue(name: command, atMs: atMs)
        }
    }

    private func flushQueuedCommands() {
        for item in CommandQueue.drain() {
            send(["type": "command", "name": item.name, "at": item.atMs])
        }
    }
}

// App 没活着时收到的命令先存起来（UserDefaults），网页 ready 后按原时间戳补发
enum CommandQueue {
    struct Item { let name: String; let atMs: Double }
    private static let key = "pendingCommands"

    static func enqueue(name: String, atMs: Double) {
        var list = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        list.append(["name": name, "at": atMs])
        UserDefaults.standard.set(list, forKey: key)
    }

    static func drain() -> [Item] {
        let list = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        UserDefaults.standard.removeObject(forKey: key)
        return list.compactMap { dict in
            guard let name = dict["name"] as? String, let at = dict["at"] as? Double else { return nil }
            return Item(name: name, atMs: at)
        }
    }
}
