"""本地开发服务器：和 python -m http.server 一样提供静态文件，但所有响应带 Cache-Control: no-store。
否则浏览器在 Service Worker 还没接管的第一次加载里会用 HTTP 缓存里的旧 js 配新 js，模块导入报错。
用法：python tools/dev-server.py 8080
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.js': 'application/javascript',
        '.json': 'application/json',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):  # 简短日志
        sys.stderr.write('%s %s\n' % (self.command, args[0] if args else ''))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = partial(NoCacheHandler, directory='.')
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
