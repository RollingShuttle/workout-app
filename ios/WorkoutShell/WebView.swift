// WebView.swift — WKWebView 的 SwiftUI 包装：自定义 scheme 加载 bundle 里的 web/，JS 的 alert / confirm 弹原生框，
// 外链交给 Safari。
import SwiftUI
import WebKit
import SafariServices

struct WebContainerView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.userContentController.add(Bridge.shared, name: "native")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never // 安全区由网页自己处理
        webView.scrollView.bounces = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true // Mac 上 Safari → 开发 → iPhone 可以看控制台
        }
        #endif

        Bridge.shared.attach(webView)
        webView.load(URLRequest(url: AppSchemeHandler.indexURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        // 只允许走自定义 scheme；http(s) 外链用 Safari 打开
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
            if url.scheme == AppSchemeHandler.scheme || url.scheme == "about" {
                return decisionHandler(.allow)
            }
            if url.scheme == "http" || url.scheme == "https" {
                TopViewController.present(SFSafariViewController(url: url))
            }
            decisionHandler(.cancel)
        }

        // 网页用的 window.alert / window.confirm（结束训练、放弃、删除、清空都靠 confirm）
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
            TopViewController.present(alert)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
            TopViewController.present(alert)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
            TopViewController.present(alert)
        }

        // 网页进程被系统回收（内存紧张）：重新加载
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.load(URLRequest(url: AppSchemeHandler.indexURL))
        }
    }
}
