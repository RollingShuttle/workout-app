// ContentView.swift — 手表主页面。第 3 步只是占位：标题 + 一句说明。
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("训练")
                .font(.title2.bold())
            Text("等手机同步…")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    ContentView()
}
