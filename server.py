import http.server
import json
import os
import urllib.error
import urllib.parse
import urllib.request

BACKEND = os.environ.get("BACKEND_URL", "http://34.143.183.160:3000").rstrip("/")
PORT = int(os.environ.get("PORT", "5173"))


class GatewayHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self.health_check()
            return
        if parsed.path.startswith("/api/"):
            self.proxy_request(parsed)
            return
        if parsed.path in {"/callback", "/oauth2/idpresponse"}:
            self.serve_file("index.html")
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.proxy_request(parsed)
            return
        self.send_error(404, "Not Found")

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.proxy_request(parsed)
            return
        self.send_error(404, "Not Found")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.proxy_request(parsed)
            return
        self.send_error(404, "Not Found")

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.proxy_request(parsed)
            return
        self.send_error(404, "Not Found")

    def health_check(self):
        body = json.dumps({"status": "ok"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, filename):
        with open(filename, "rb") as f:
            body = f.read()

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_request(self, parsed):
        target_path = parsed.path.lstrip("/")
        target = urllib.parse.urljoin(f"{BACKEND}/", target_path)
        if parsed.query:
            target = f"{target}?{parsed.query}"

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; SewtechGateway/1.0)"
        }
        for key, value in self.headers.items():
            if key.lower() in {"host", "content-length"}:
                continue
            headers[key] = value

        body = None
        content_length = self.headers.get("Content-Length")
        if content_length:
            try:
                body = self.rfile.read(int(content_length))
            except Exception:
                body = None

        request = urllib.request.Request(
            target,
            data=body,
            headers=headers,
            method=self.command,
        )

        try:
            with urllib.request.urlopen(request, timeout=10) as upstream:
                upstream_body = upstream.read()
                self.send_response(upstream.status)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(upstream_body)))
                self.end_headers()
                if upstream_body:
                    self.wfile.write(upstream_body)
        except urllib.error.HTTPError as error:
            error_body = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            if error_body:
                self.wfile.write(error_body)
        except (urllib.error.URLError, TimeoutError) as error:
            error_body = json.dumps({"error": str(error)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), GatewayHandler).serve_forever()