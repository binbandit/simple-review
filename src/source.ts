import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { git, type Hunk, type Skipped } from "@/git";

async function optionalStat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readSource(cwd = process.cwd()) {
  let root = resolve(cwd);
  while (!(await optionalStat(join(root, "src")))?.isDirectory()) {
    if (dirname(root) === root || await optionalStat(join(root, ".git"))) {
      throw new Error("No src directory found. Run review --all from a project containing src.");
    }
    root = dirname(root);
  }
  // Use Git's own ignore rules when available, including untracked source files.
  let included: Set<string> | undefined;
  for (let directory = root; ; directory = dirname(directory)) {
    if (await optionalStat(join(directory, ".git"))) {
      included = new Set((await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src/"], root)).split("\0").filter(Boolean));
      break;
    }
    if (dirname(directory) === directory) break;
  }
  const directories = new Set<string>();
  for (const file of included ?? []) {
    for (let dir = dirname(file); dir !== "."; dir = dirname(dir)) directories.add(dir);
  }
  const hunks: Hunk[] = [];
  const skipped: Skipped[] = [];
  let files = 0;
  async function walk(directory: string) {
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!included || directories.has(file)) await walk(file);
        continue;
      }
      if (included && !included.has(file)) continue;
      files++;
      if (!entry.isFile()) {
        skipped.push({ file, reason: "Not a regular file (symlinks are not followed)." });
        continue;
      }
      const bytes = await readFile(join(root, file));
      let text: string;
      try {
        if (bytes.includes(0)) throw new Error("Binary file");
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        skipped.push({ file, reason: "Binary or non-UTF-8 file." });
        continue;
      }
      const source = splitSource(relative(root, join(root, file)), text);
      hunks.push(...source.hunks);
      skipped.push(...source.skipped);
    }
  }
  await walk("src");
  return { root, hunks, skipped, files };
}

function splitSource(file: string, text: string) {
  const source = text.split("\n");
  if (source.at(-1) === "") source.pop();
  const hunks: Hunk[] = [];
  const skipped: Skipped[] = [];
  const lines = source.map((text, index) => ({
    id: `source:${index + 1}`, kind: "context" as const, oldLine: null,
    newLine: index + 1, text: text.replace(/\r$/, ""),
  }));
  function section(start: number, end: number) {
    let from = Math.max(0, start - 8);
    let to = Math.min(lines.length, end + 8);
    const size = () => Buffer.byteLength(JSON.stringify({
      file,
      source: lines.slice(from, to).map((line) => ({ id: line.id, line: line.newLine, text: line.text })),
      focus: lines.slice(start, end).map((line) => line.id),
    }));
    while (size() > 18_000 && (from < start || to > end)) {
      if (to > end) to--;
      if (from < start) from++;
    }
    if (size() > 18_000) {
      if (end - start === 1) {
        skipped.push({ file, reason: `Line ${start + 1} exceeds the source review size limit.` });
      } else {
        const middle = Math.floor((start + end) / 2);
        section(start, middle);
        section(middle, end);
      }
      return;
    }
    hunks.push({ file, oldFile: file, header: `Source lines ${start + 1}-${end}`,
      focus: { start: start + 1, end }, lines: lines.slice(from, to) });
  }
  for (let start = 0; start < lines.length; start += 120) section(start, Math.min(start + 120, lines.length));
  return { hunks, skipped };
}
