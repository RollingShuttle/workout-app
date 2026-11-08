// BackupStore.swift — 自动备份：网页每次改动后把整份备份 JSON 发来（backup.save），存到 App 自己的 Documents 文件夹。
// Info.plist 开了 UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace，所以 文件 App → 我的 iPhone → 训练 里能看到这个文件。
// 第一次打开时网页可以要回最新的一份恢复（backup.load → backup.result）。付费账号通过后改成 iCloud 云盘容器（方案 10.1 第 2 步）。
import Foundation

enum BackupStore {
    static var directory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    @discardableResult
    static func save(name: String, json: String) -> Bool {
        let safeName = (name as NSString).lastPathComponent // 不让网页指定路径
        guard !safeName.isEmpty, safeName != ".", safeName != ".." else { return false }
        let url = directory.appendingPathComponent(safeName)
        do {
            try json.write(to: url, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    // 最新改动的一个 .json（用户也可能自己把导出的文件放进这个文件夹）
    static func latest() -> (name: String, text: String, savedAtMs: Double)? {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles]) else {
            return nil
        }
        let dated: [(url: URL, date: Date)] = items
            .filter { $0.pathExtension.lowercased() == "json" }
            .map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
        guard let newest = dated.max(by: { $0.date < $1.date }), let text = try? String(contentsOf: newest.url, encoding: .utf8) else {
            return nil
        }
        return (newest.url.lastPathComponent, text, newest.date.timeIntervalSince1970 * 1000)
    }
}
