from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
class Handler(BaseHTTPRequestHandler):
 protocol_version = "HTTP/1.1"
 def do_GET(self):
  self.send_response(200); self.send_header("Content-Length", "1024"); self.end_headers(); self.wfile.write(b"x"*1024)
 def log_message(self,*args): pass
ThreadingHTTPServer(("127.0.0.1",18763),Handler).serve_forever()
