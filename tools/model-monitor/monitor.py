#!/usr/bin/env python3
"""Local reverse proxy that records which model each AI request asks for.

Point a client's base URL at http://127.0.0.1:<port> and it forwards the request
to the Octane AI platform, logging one JSON line per call to a file. It records
the requested model, path, response status, timing and client identifiers. It
does not record prompts, responses, or the Authorization header.

Usage:
  python3 monitor.py --upstream https://llm.ai-dev.octane.co --port 8787 \
      --log ~/.gbrain/model-monitor.jsonl
"""

import argparse
import datetime as dt
import http.client
import json
import os
import ssl
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Headers that describe the calling tool. Authorization and cookies are never logged.
CLIENT_HEADERS = ("user-agent", "x-stainless-package-version", "x-app", "http-referer",
                  "x-title", "x-kilo-client", "x-request-id-client", "x-session-id")
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
              "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
              "accept-encoding"}

_log_lock = threading.Lock()


def extract_model(body: bytes):
    """Return the model named in a JSON request body, or None."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    model = data.get("model") if isinstance(data, dict) else None
    return model if isinstance(model, str) else None


class Handler(BaseHTTPRequestHandler):
    server_version = "model-monitor/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieten the default stderr access log
        return

    def _forward(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        model = extract_model(body) if body else None

        upstream = urllib.parse.urlsplit(self.server.upstream)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        headers["Host"] = upstream.netloc
        started = time.time()
        status, resp_headers, resp_body = None, [], b""
        try:
            conn_cls = http.client.HTTPSConnection if upstream.scheme == "https" else http.client.HTTPConnection
            kwargs = {"context": ssl.create_default_context()} if upstream.scheme == "https" else {}
            conn = conn_cls(upstream.hostname, upstream.port, timeout=600, **kwargs)
            conn.request(self.command, self.path, body=body or None, headers=headers)
            resp = conn.getresponse()
            status = resp.status
            resp_headers = resp.getheaders()
            resp_body = resp.read()
            conn.close()
        except Exception as exc:  # network or TLS failure
            status = 502
            resp_body = json.dumps({"error": f"monitor upstream failure: {exc}"}).encode()
            resp_headers = [("Content-Type", "application/json")]

        record = {
            "time": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "method": self.command,
            "path": self.path.split("?")[0],
            "model": model,
            "status": status,
            "duration_ms": int((time.time() - started) * 1000),
            "client": {k: self.headers.get(k) for k in CLIENT_HEADERS if self.headers.get(k)},
        }
        with _log_lock:
            with open(self.server.log_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")

        self.send_response(status)
        for k, v in resp_headers:
            if k.lower() not in HOP_BY_HOP:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _forward


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--upstream", default="https://llm.ai-dev.octane.co")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--log", default=os.path.expanduser("~/.gbrain/model-monitor.jsonl"))
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.log), exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.upstream = args.upstream
    server.log_path = args.log
    print(f"model-monitor: 127.0.0.1:{args.port} -> {args.upstream}, logging to {args.log}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
