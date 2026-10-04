// npm run dev: serves index.html and /api/* locally with Gemini and Supabase mocked (no keys needed).
import http from "node:http";
import fs from "node:fs";
import { installMocks } from "./mocks.js";

installMocks({ entriesFile: process.env.ENTRIES_FILE, log: true });
const routes = { "/api/ask": (await import("../api/ask.js")).default, "/api/stats": (await import("../api/stats.js")).default };
const port = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (routes[path]) {
    let raw = ""; for await (const c of req) raw += c;
    const vreq = { method: req.method, headers: req.headers, socket: req.socket, body: raw ? JSON.parse(raw) : {} };
    const vres = {
      status(c) { res.statusCode = c; return vres; },
      json(o) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return vres; },
      setHeader(k, v) { res.setHeader(k, v); }
    };
    return routes[path](vreq, vres);
  }
  if (path === "/" || path === "/index.html") { res.setHeader("content-type", "text/html"); return res.end(fs.readFileSync("index.html")); }
  res.statusCode = 404; res.end("not found");
}).listen(port, () => console.log(`http://localhost:${port}`));
