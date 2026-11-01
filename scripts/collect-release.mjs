// Collects what `electron-forge make` produced into out/release/ under clean, space-free names, and writes
// out/release/SHA256SUMS-<platform>.txt. GitHub renames files with spaces on upload, which would break the checksums.
//   Windows: SIDB-<v>-Setup.exe, SIDB-<v>-win-x64.zip
//   Linux:   sidb_<v>_amd64.deb, sidb-<v>-1.x86_64.rpm, SIDB-<v>-linux-x64.zip
// Check a download:  Windows: Get-FileHash .\SIDB-<v>-Setup.exe -Algorithm SHA256   Linux: sha256sum -c --ignore-missing SHA256SUMS.txt
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const make = path.join(root, "out", "make");
const out = path.join(root, "out", "release");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

if (!existsSync(make)) {
  console.error("out/make not found; run `electron-forge make` first");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** [pattern on the produced file, release name] */
const RULES = [
  [/[\\/]squirrel\.windows[\\/].*Setup\.exe$/i, `SIDB-${version}-Setup.exe`],
  [/[\\/]zip[\\/]win32[\\/].*\.zip$/i, `SIDB-${version}-win-x64.zip`],
  [/[\\/]zip[\\/]linux[\\/].*\.zip$/i, `SIDB-${version}-linux-x64.zip`],
  [/\.deb$/i, null],
  [/\.rpm$/i, null],
];

const collected = [];
for (const f of files(make)) {
  const rule = RULES.find(([re]) => re.test(f));
  if (!rule) continue;
  const name = rule[1] ?? path.basename(f);
  if (/\s/.test(name)) throw new Error(`release file name has a space: ${name}`);
  copyFileSync(f, path.join(out, name));
  collected.push(name);
}
if (collected.length === 0) {
  console.error("no installers found in out/make");
  process.exit(1);
}

const hash = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
const lines = [];
for (const n of collected.sort()) lines.push(`${await hash(path.join(out, n))}  ${n}`);
const sums = `SHA256SUMS-${process.platform}.txt`;
writeFileSync(path.join(out, sums), lines.join("\n") + "\n");
console.log(`out/release: ${collected.length} files and ${sums}`);
for (const l of lines) console.log("  " + l);
