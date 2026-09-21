import { expect, test } from "bun:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { parseDiff } from "@/git";
import { reviewHunk } from "@/review";
import { slopCases } from "./slop-cases";

// Run explicitly with `just eval`; normal tests never call the live API.
if (!Bun.env.TYPESAFE_API_KEY?.trim()) throw new Error("Set TYPESAFE_API_KEY to run the live Jev evaluation.");
const client = new TypeSafeClient({ timeout: 20_000, logLevel: "off" });

for (const fixture of slopCases) {
  for (const variant of ["problematic", "legitimate"] as const) {
    test(`${fixture.rule}: ${variant}`, async () => {
      const before = fixture.before.split("\n");
      const after = fixture[variant].split("\n");
      const patch = [
        `diff --git a/${fixture.file} b/${fixture.file}`,
        `--- a/${fixture.file}`, `+++ b/${fixture.file}`,
        `@@ -1,${before.length} +1,${after.length} @@`,
        ...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`), "",
      ].join("\n");
      const result = await reviewHunk(client, parseDiff(patch).hunks[0]!, 0.85);
      expect(result.skipped).toBeUndefined();
      console.log(`${fixture.rule}/${variant}: model=${result.model}; findings=${result.findings.map((finding) => `${finding.rule}@${finding.line}:${finding.probability.toFixed(2)}`).join(",") || "none"}`);
      // Check this rule's boundary; other findings may be independently valid.
      expect(result.findings.some((finding) => finding.rule === fixture.rule)).toBe(variant === "problematic");
    }, 65_000);
  }
}
