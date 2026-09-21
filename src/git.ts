export type DiffLine = {
  id: string;
  kind: "added" | "removed" | "context";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export interface Hunk {
  file: string;
  oldFile: string;
  header: string;
  lines: DiffLine[];
  focus?: { start: number; end: number };
}

export interface Skipped {
  file: string;
  reason: string;
}

export async function git(args: string[], cwd = process.cwd(), input?: string) {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `Git exited with code ${code}.`);
  return stdout;
}

export async function readDiff(options: { staged: boolean; base?: string }, cwd = process.cwd()) {
  const root = (await git(["rev-parse", "--show-toplevel"], cwd)).trimEnd();
  if (await git(["ls-files", "--unmerged"], root)) {
    throw new Error("Resolve merge conflicts before running review.");
  }
  let revisions: string[];
  if (options.staged) {
    revisions = ["--cached"];
  } else if (options.base) {
    const base = (await git(["rev-parse", "--verify", "--end-of-options", `${options.base}^{commit}`], root)).trim();
    const ancestor = (await git(["merge-base", base, "HEAD"], root)).trim();
    revisions = [ancestor];
  } else {
    try {
      revisions = [(await git(["rev-parse", "--verify", "HEAD"], root)).trim()];
    } catch {
      revisions = [(await git(["hash-object", "-t", "tree", "--stdin"], root, "")).trim()];
    }
  }
  const patch = await git([
    "-c", "core.quotePath=true", "diff", "--no-ext-diff", "--no-textconv",
    "--no-color", "--find-renames", "--unified=8", "--ignore-submodules=none", "--submodule=short",
    "--src-prefix=a/", "--dst-prefix=b/", "--line-prefix=", "--output-indicator-new=+",
    "--output-indicator-old=-", "--output-indicator-context= ", ...revisions, "--",
  ], root);
  return { root, ...parseDiff(patch) };
}

function decodePath(value: string) {
  const path = value.replace(/\t$/, "");
  if (!path.startsWith('"')) return path.slice(2);
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const quoted = path.slice(1, -1);
  for (let i = 0; i < quoted.length; i++) {
    const char = quoted[i]!;
    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const octal = quoted.slice(i + 1).match(/^[0-7]{3}/)?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
    } else {
      bytes.push(escapes[quoted[++i]!] ?? 63);
    }
  }
  return Buffer.from(bytes).toString("utf8").slice(2);
}

export function parseDiff(patch: string) {
  const hunks: Hunk[] = [];
  const skipped: Skipped[] = [];
  const blocks = patch.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const rawLines = block.split("\n");
    if (/^index .* 160000$|^(?:new|deleted) file mode 160000$/m.test(block)) {
      skipped.push({ file: rawLines[0] || "submodule", reason: "Submodule contents are not included in this diff. Review the submodule separately." });
      continue;
    }
    let oldFile = "";
    let file = "";
    let hunk: Hunk | undefined;
    let oldLine = 0;
    let newLine = 0;
    const start = hunks.length;
    for (const raw of rawLines) {
      if (!hunk && raw.startsWith("--- ")) oldFile = raw.slice(4) === "/dev/null" ? "" : decodePath(raw.slice(4));
      else if (!hunk && raw.startsWith("+++ ")) file = raw.slice(4) === "/dev/null" ? oldFile : decodePath(raw.slice(4));
      else if (raw.startsWith("@@ ")) {
        const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (!match || !file) throw new Error("Could not parse a Git diff hunk.");
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        hunk = { file, oldFile: oldFile || file, header: raw, lines: [] };
        hunks.push(hunk);
      } else if (hunk && /^[ +\-]/.test(raw)) {
        const kind = raw[0] === "+" ? "added" : raw[0] === "-" ? "removed" : "context";
        hunk.lines.push({
          id: `L${hunk.lines.length + 1}`,
          kind,
          oldLine: kind === "added" ? null : oldLine++,
          newLine: kind === "removed" ? null : newLine++,
          text: raw.slice(1),
        });
      }
    }
    if (hunks.length === start) {
      skipped.push({ file: file || rawLines[0] || "unknown", reason: "No text hunks (binary, rename, or file mode change)." });
    }
  }
  return { hunks, skipped, files: blocks.length };
}
