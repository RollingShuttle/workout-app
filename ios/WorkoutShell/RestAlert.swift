// RestAlert.swift — 组间休息到点、App 在前台时的提醒：一串震动，开了提示音再用 .playback 会话放铃声（静音键打开也响）。
// 两条路都会叫到这里：网页的秒表走到参考时长（restTimer.fire）、组间通知在前台到点（AppDelegate.willPresent）。5 秒内只响一次。
// 锁屏 / 后台时不走这里，靠本地通知（Notifications.swift）出声和震动。
import AVFoundation
import UIKit

enum RestAlert {
    private static var player: AVAudioPlayer?
    private static var lastFiredAt = Date.distantPast
    private static let playerDelegate = PlayerDelegate()

    static func fire(sound: Bool) {
        DispatchQueue.main.async {
            let now = Date()
            guard now.timeIntervalSince(lastFiredAt) > 5 else { return }
            lastFiredAt = now
            buzz()
            if sound { chime() }
        }
    }

    // 三下重击 + 一声"成功"，比单下 success 明显
    private static func buzz() {
        let heavy = UIImpactFeedbackGenerator(style: .heavy)
        heavy.prepare()
        for i in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.22) { heavy.impactOccurred() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    // .playback 不受静音键影响；duckOthers 让正在放的音乐压低一下，放完恢复
    private static func chime() {
        guard let url = Bundle.main.url(forResource: "rest-alert", withExtension: "wav") else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.duckOthers])
            try session.setActive(true)
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = playerDelegate
            p.volume = 1
            p.prepareToPlay()
            p.play()
            player = p
        } catch {
            player = nil
        }
    }

    private final class PlayerDelegate: NSObject, AVAudioPlayerDelegate {
        func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
            RestAlert.player = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}
