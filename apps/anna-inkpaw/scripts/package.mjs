import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

// Explicit allow-list: never package fixtures, node_modules, environment or credentials.
const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const files = (await readdir(new URL("bundle/", root))).sort();
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".txt": "text/plain" };
const fileMap = {};
await mkdir(new URL("bundle/", output), { recursive: true });
for (const name of files) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || !types[path.extname(name)]) throw new Error(`Unexpected bundle file: ${name}`);
  const bytes = await readFile(new URL(`bundle/${name}`, root));
  fileMap[name] = { byte_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), content_type: types[path.extname(name)] };
  await writeFile(new URL(`bundle/${name}`, output), bytes);
}
for (const name of ["manifest.json", "app.json"]) await copyFile(new URL(name, root), new URL(name, output));
await writeFile(new URL("file-map.json", output), JSON.stringify({ file_map: fileMap }, null, 2) + "\n");
console.log(`Offline package: ${files.length} bundle files; no upload performed.`);
