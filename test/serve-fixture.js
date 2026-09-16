"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let relativePath = urlPath === "/" ? "/test/mock-messenger/index.html" : urlPath;
  let targetFile = path.resolve(root, `.${relativePath}`);

  if (!targetFile.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
    targetFile = path.join(targetFile, "index.html");
  }

  if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
    const mockFallback = path.resolve(root, `./test/mock-messenger${relativePath}`);
    if (fs.existsSync(mockFallback) && fs.statSync(mockFallback).isFile()) {
      targetFile = mockFallback;
    } else {
      res.writeHead(404).end("Not Found");
      return;
    }
  }

  const ext = path.extname(targetFile).toLowerCase();
  res.writeHead(200, {
    "content-type": types[ext] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  fs.createReadStream(targetFile).pipe(res);
});

const PORT = process.env.PORT || 4173;
const HOST = "127.0.0.1";

server.listen(PORT, HOST, () => {
  console.log(`Mock Messenger fixture server running at http://${HOST}:${PORT}/test/mock-messenger/`);
});
