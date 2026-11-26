"""Tiny local server for the System Blink test page.

Usage:  python3 test/server.py [port]
Then open http://localhost:8125/test/index.html  (options: ?fresh  ?lang=ko   ?nochat)
"""
import os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8125


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=REPO)).serve_forever()
