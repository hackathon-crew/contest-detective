import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
// Only this package's generated output is removed. Never carry stale bundle files forward.
await rm(output, { recursive: true, force: true });
await mkdir(new URL("bundle/", output), { recursive: true });
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".txt": "text/plain",
};
for (const name of (await readdir(new URL("bundle/", root))).sort()) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || !types[path.extname(name)])
    throw new Error(`Unexpected authored asset: ${name}`);
  await copyFile(
    new URL(`bundle/${name}`, root),
    new URL(`bundle/${name}`, output),
  );
}
const compiled = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("node_modules/typescript/bin/tsc", root))],
  { cwd: fileURLToPath(root), stdio: "inherit" },
);
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
const fileMap = {};
async function visit(relative = "") {
  for (const entry of (
    await readdir(new URL(`bundle/${relative}`, output), {
      withFileTypes: true,
    })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative + entry.name;
    if (entry.isDirectory()) {
      await visit(`${name}/`);
      continue;
    }
    if (
      !entry.isFile() ||
      !/^[A-Za-z0-9_.\/-]+$/.test(name) ||
      !types[path.extname(name)]
    )
      throw new Error(`Unexpected bundle file: ${name}`);
    const bytes = await readFile(new URL(`bundle/${name}`, output));
    if (bytes.length > 10_000_000)
      throw new Error(`Bundle file too large: ${name}`);
    fileMap[name] = {
      byte_size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content_type: types[path.extname(name)],
    };
  }
}
await visit();
for (const name of ["manifest.json", "app.json"])
  await copyFile(new URL(name, root), new URL(name, output));
await writeFile(
  new URL("file-map.json", output),
  JSON.stringify({ file_map: fileMap }, null, 2) + "\n",
);
console.log(
  `Offline package: ${Object.keys(fileMap).length} bundle files; no login or upload performed.`,
);
