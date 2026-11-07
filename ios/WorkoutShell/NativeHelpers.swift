// NativeHelpers.swift — 震动、分享导出、文件导入、找最上层的 ViewController。
import UIKit
import UniformTypeIdentifiers

enum Haptics {
    static func play(_ kind: String) {
        DispatchQueue.main.async {
            switch kind {
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error":
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }
    }
}

enum TopViewController {
    static func current() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    static func present(_ vc: UIViewController) {
        DispatchQueue.main.async {
            guard let top = current() else { return }
            if let pop = vc.popoverPresentationController { // iPad 的分享面板要有锚点
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
            }
            top.present(vc, animated: true)
        }
    }
}

// 导出：把 JSON 写到临时文件，弹系统分享面板（存到"文件"/ iCloud Drive / 隔空投送）
enum Share {
    static func exportJSON(name: String, json: String) {
        let safeName = name.isEmpty ? "workout-backup.json" : name
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try json.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            return
        }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        TopViewController.present(vc)
    }
}

// 导入：系统文件选择器，选中后读成文本回传给网页
enum FileImport {
    private static var delegate: PickerDelegate?

    static func pick(_ done: @escaping (String, String) -> Void) {
        let types: [UTType] = [.json, .plainText, .text]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        let d = PickerDelegate { url in
            defer { delegate = nil }
            guard let url = url else { return }
            let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            done(url.lastPathComponent, text)
        }
        delegate = d
        picker.delegate = d
        picker.allowsMultipleSelection = false
        TopViewController.present(picker)
    }

    private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
        let done: (URL?) -> Void
        init(done: @escaping (URL?) -> Void) { self.done = done }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls.first) }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done(nil) }
    }
}
