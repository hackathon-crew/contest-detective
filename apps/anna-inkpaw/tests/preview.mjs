import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/bundle/", import.meta.url));
const sdk = fileURLToPath(
  new URL("./fixtures/browser-sdk.mjs", import.meta.url),
);
createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1:4327");
    if (u.pathname === "/preview") {
      const width = Math.min(
        1440,
        Math.max(320, Number(u.searchParams.get("width")) || 1040),
      );
      const theme = u.searchParams.get("theme") === "dark" ? "dark" : "light";
      const lang = u.searchParams.get("lang") === "zh-CN" ? "zh-CN" : "en";
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<!doctype html><html><body style="margin:0;background:#7e857c"><header style="padding:12px;text-align:center;background:#7b1f17;color:white;font:14px system-ui">OFFLINE SIMULATION / 离线模拟 · Synthetic facts · No live calls</header><iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" title="Inkpaw offline simulation" style="display:block;margin:12px auto;border:0;width:${width}px;height:1600px;max-width:100%" src="/?theme=${theme}&lang=${lang}"></iframe></body></html>`,
      );
      return;
    }
    if (u.pathname === "/static/anna-apps/_sdk/latest/index.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await readFile(sdk));
      return;
    }
    const file = path.resolve(
      root,
      u.pathname === "/"
        ? "index.html"
        : decodeURIComponent(u.pathname.slice(1)),
    );
    if (!file.startsWith(root)) throw Error();
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".txt": "text/plain",
      }[path.extname(file)] ?? "text/plain",
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(4327, "127.0.0.1", () =>
  console.log(
    "Offline mock preview listening on http://127.0.0.1:4327/preview",
  ),
);
