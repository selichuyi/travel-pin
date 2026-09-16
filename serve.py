#!/usr/bin/env python3
"""Travel Pin 本地服务器：静态文件 + POST /api/save 回写 data/travel.json。"""

import json
import os
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, 'data', 'travel.json')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 静态资源一律不缓存，避免浏览器把旧版 HTML/JS 留在本地
        if self.command in ('GET', 'HEAD'):
            self.send_header(
                'Cache-Control', 'no-cache, no-store, must-revalidate'
            )
        super().end_headers()

    def do_POST(self):
        if self.path.split('?')[0] != '/api/save':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(length) or b'{}')
            places = payload.get('places')
            journeys = payload.get('journeys')
            if not isinstance(places, list) or not isinstance(journeys, list):
                raise ValueError('payload must contain places/journeys arrays')
            data = {'places': places, 'journeys': journeys}
            if isinstance(payload.get('tags'), list):
                data['tags'] = payload['tags']
            fd, tmp = tempfile.mkstemp(
                dir=os.path.dirname(DATA_FILE), suffix='.json'
            )
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, DATA_FILE)
            body = json.dumps({'ok': True, 'places': len(places)}).encode()
            status = 200
        except Exception as err:  # noqa: BLE001 - 原样回报给前端提示
            body = json.dumps({'ok': False, 'error': str(err)}).encode()
            status = 400
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
