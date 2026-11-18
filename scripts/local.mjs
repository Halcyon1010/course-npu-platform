import "./build.mjs";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { storage } from "./storage.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const { default: worker, tick } = await import("../dist/server/index.js");
const env = { ...process.env, ...storage(process.env.DATA_DIR) };
const recordFile = join(process.env.DATA_DIR || ".runtime", "ta-account.json");
if (!env.TA_LOGIN_RECORD && existsSync(recordFile))
  env.TA_LOGIN_RECORD = readFileSync(recordFile, "utf8");
const port = Number(process.env.PORT || 8787),
  host = process.env.HOST || "127.0.0.1";
const ctx = {
  waitUntil: (promise) => promise.catch((err) => console.error(err.name)),
};
const server = createServer(async (req, res) => {
  try {
    const url = "http://" + req.headers.host + req.url;
    const opts = { method: req.method, headers: req.headers };
    if (!["GET", "HEAD"].includes(req.method)) {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 9 * 1024 * 1024) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"zip_size"}');
          return;
        }
        chunks.push(chunk);
      }
      opts.body = Buffer.concat(chunks);
    }
    const result = await worker.fetch(new Request(url, opts), env, ctx);
    res.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(res);
    else res.end();
  } catch (e) {
    res.writeHead(500);
    res.end();
  }
});
server.listen(port, host, () =>
  console.log("Course Compute · http://" + host + ":" + port),
);
setInterval(() => ctx.waitUntil(tick(env)), 3000).unref();
