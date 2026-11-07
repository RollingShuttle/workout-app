// AppSchemeHandler.swift — 把 bundle 里的 web/ 目录当静态服务器：app://local/index.html → web/index.html。
// 用自定义 scheme 而不是 file://，是为了 IndexedDB 有固定 origin、能持久化，ES module 和 fetch 也正常。
import WebKit
import UniformTypeIdentifiers

final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    static let host = "local"
    static let indexURL = URL(string: "\(scheme)://\(host)/index.html")!

    private static let webRoot: URL? = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        guard let root = Self.webRoot else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let fileURL = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        // 不让 ../ 跑出 web/ 目录
        guard fileURL.path.hasPrefix(root.standardizedFileURL.path), let data = FileManager.default.contents(atPath: fileURL.path) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(Data("not found: \(path)".utf8))
            urlSchemeTask.didFinish()
            return
        }
        let headers = [
            "Content-Type": Self.mimeType(for: fileURL.pathExtension),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 文件都是同步读完就返回的，没有可取消的
    }

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default:
            if let type = UTType(filenameExtension: ext), let mime = type.preferredMIMEType { return mime }
            return "application/octet-stream"
        }
    }
}
