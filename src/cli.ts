#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { APIConnectionError, APIError, APIUserAbortError, TypeSafeClient } from "@typesafe-ai/sdk";
import { readDiff } from "@/git";
import { formatReport, reviewHunk, safeText, type Report } from "@/review";

const help = `review - spot potential bugs, security regressions, and AI slop in a Git diff

Usage: review [--staged | --base <ref>] [--json] [--threshold <0..1>]

  review              Review tracked working-tree changes against HEAD (staged + unstaged)
  review --staged     Review only staged changes
  review --base main  Review changes since the merge base with main, including local edits
  review --json       Emit one JSON report for an agent or script
  --threshold <n>     Minimum issue probability to report (default: 0.85)
  -h, --help          Show this help
  -v, --version       Show the version

Set TYPESAFE_API_KEY to use Jev. TYPESAFE_DEFAULT_MODEL defaults to jev-latest.
Diff hunks and eight lines of surrounding context are sent to TypeSafe.
Untracked files are excluded; stage them with git add to include them.
Exit codes: 0 = no findings, 1 = findings, 2 = error or incomplete review.
`;

let json = Bun.argv.slice(2).includes("--json");
try {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      staged: { type: "boolean", default: false },
      base: { type: "string" },
      json: { type: "boolean", default: false },
      threshold: { type: "string", default: "0.85" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
    allowPositionals: false,
  });
  json = values.json;
  if (values.help) {
    console.log(help);
  } else if (values.version) {
    console.log("review 0.1.0");
  } else {
    if (values.staged && values.base !== undefined) throw new Error("Use either --staged or --base, not both.");
    if (values.base !== undefined && !values.base.trim()) throw new Error("--base requires a nonempty Git reference.");
    const threshold = Number(values.threshold);
    if (!values.threshold.trim() || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error("--threshold must be a number between 0 and 1.");
    }
    const diff = await readDiff(values);
    const report: Report = {
      version: 1,
      scope: values.staged ? "staged changes" : values.base ? `changes since merge base with ${values.base}` : "tracked changes against HEAD",
      root: diff.root,
      models: [],
      threshold,
      files: diff.files,
      reviewedHunks: 0,
      findings: [],
      skipped: diff.skipped,
      complete: false,
    };
    if (diff.hunks.length) {
      if (!Bun.env.TYPESAFE_API_KEY?.trim()) throw new Error("Set TYPESAFE_API_KEY before reviewing changes. Get a key at https://console.typesafe.ai.");
      const client = new TypeSafeClient({ timeout: 20_000, logLevel: "off" });
      for (const [index, hunk] of diff.hunks.entries()) {
        if (!json && process.stderr.isTTY) console.error(safeText(`Reviewing ${index + 1}/${diff.hunks.length}: ${hunk.file}`));
        const result = await reviewHunk(client, hunk, threshold);
        report.findings.push(...result.findings);
        if (result.skipped) report.skipped.push(result.skipped);
        else report.reviewedHunks++;
        if (result.model && !report.models.includes(result.model)) report.models.push(result.model);
      }
    }
    const severity = { high: 0, medium: 1, low: 2 };
    report.findings.sort((a, b) => severity[a.severity] - severity[b.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
    report.complete = report.skipped.length === 0;
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exitCode = !report.complete ? 2 : report.findings.length ? 1 : 0;
  }
} catch (error) {
  let message: string;
  if (error instanceof APIError) message = `TypeSafe request failed (HTTP ${error.status}). ${error.status === 401 ? "Check TYPESAFE_API_KEY." : "Check your account, model, or service availability and retry."}`;
  else if (error instanceof APIConnectionError || error instanceof APIUserAbortError) message = "TypeSafe could not complete the request within the retry/time limit. Check your connection and retry.";
  else message = error instanceof Error ? error.message : "Review failed.";
  if (json) console.log(JSON.stringify({ version: 1, complete: false, error: message }));
  else console.error(`review: ${safeText(message)}`);
  process.exitCode = 2;
}
