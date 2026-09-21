import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SystemOneRequestPayload } from "@typesafe-ai/sdk";
import { git, readDiff } from "@/git";
import type { Report, ReviewState } from "@/review";
import { rules } from "@/rules";
import { slopCases } from "./slop-cases";

const temporary = await mkdtemp(join(tmpdir(), "review-test-"));
const binary = join(temporary, "review");
const repos: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", resolve("src/cli.ts"), "--outfile", binary], { stdout: "ignore", stderr: "pipe" });
  const error = await new Response(build.stderr).text();
  expect(await build.exited, error).toBe(0);
});

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

afterAll(() => rm(temporary, { recursive: true, force: true }));

async function repository(initial = "export const value = 1;\n", filename = "app.ts", commit = true) {
  const repo = await mkdtemp(join(temporary, "repo-"));
  repos.push(repo);
  await git(["init", "-b", "main"], repo);
  await writeFile(join(repo, filename), initial);
  await git(["add", "--", filename], repo);
  if (commit) await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Initial"], repo);
  return repo;
}

async function run(repo: string, args: string[] = [], extra: Record<string, string> = {}) {
  const env = { ...process.env, ...extra };
  delete env.TYPESAFE_API_KEY;
  delete env.TYPESAFE_BASE_URL;
  delete env.TYPESAFE_DEFAULT_MODEL;
  Object.assign(env, extra);
  const child = Bun.spawn([binary, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

function service(rule?: string, side: "added" | "removed" = "added", probability = 0.97, locate = true, duplicateEvidence: "confirm" | "absent" | "same" | "old" = "confirm") {
  const requests: SystemOneRequestPayload[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body: SystemOneRequestPayload = await request.json();
      requests.push(body);
      expect(new URL(request.url).pathname).toBe("/v1/systemone");
      expect(request.headers.get("authorization")).toBe("Bearer test-key");
      if (body.questions.duplicated) {
        const state = body.state as { peerIds: string[]; primaryId: string };
        const peer = duplicateEvidence === "absent" ? "none" : duplicateEvidence === "same" ? state.primaryId : duplicateEvidence === "old" ? "old:1" : state.peerIds[0]!;
        return Response.json({ model: "jev-test", answers: {
          duplicated: { type: "noul", noul: duplicateEvidence === "absent" ? 0.01 : probability },
          peer: { type: "choice", choice: peer, confidence: 0.99, probabilities: { [peer]: 0.99 } },
        }, usage: { input_tokens: 100, output_tokens: 20 } });
      }
      const state = body.state as ReviewState;
      const selected = state.changed[side][0];
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
        if (question.type === "noul") return [id, { type: "noul", noul: id === rule ? probability : 0.01 }];
        const choice = id === `${rule}_line` && locate ? selected : "none";
        return [id, { type: "choice", choice, confidence: 0.99, probabilities: { [choice ?? "none"]: 0.99 } }];
      }));
      return Response.json({ model: "jev-test", answers, usage: { input_tokens: 100, output_tokens: 20 } });
    },
  });
  servers.push(server);
  return { requests, env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: server.url.toString() } };
}

test("help, version, invalid flags, and non-repositories work in the compiled CLI", async () => {
  expect((await run(temporary, ["--help"])).stdout).toContain("--staged");
  expect((await run(temporary, ["--version"])).stdout.trim()).toBe("review 0.1.0");
  expect((await run(temporary, ["--threshold", "NaN"])).code).toBe(2);
  expect((await run(temporary, ["--staged", "--base", "main"])).code).toBe(2);
  const unknown = await run(temporary, ["--json", "--unknown"]);
  expect(JSON.parse(unknown.stdout).complete).toBe(false);
  expect((await run(temporary)).code).toBe(2);
});

test("clean diff needs no API key and ignores untracked files", async () => {
  const repo = await repository();
  await writeFile(join(repo, "untracked.ts"), "secret\n");
  const result = await run(repo, ["--json"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ complete: true, files: 0, findings: [], models: [] });
});

test("default, staged, and base scopes include the correct snapshots from a subdirectory", async () => {
  const repo = await repository();
  await git(["checkout", "-b", "feature"], repo);
  await writeFile(join(repo, "committed.ts"), "export const committed = true;\n");
  await git(["add", "."], repo);
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Feature"], repo);
  await writeFile(join(repo, "app.ts"), "export const value = 2;\n");
  await git(["add", "."], repo);
  await writeFile(join(repo, "app.ts"), "export const value = 3;\n");
  await mkdir(join(repo, "nested"));
  const staged = await readDiff({ staged: true }, repo);
  expect(staged.hunks[0]?.lines.filter((line) => line.kind === "added")[0]?.text).toContain("= 2");
  const current = await readDiff({ staged: false }, join(repo, "nested"));
  expect(current.hunks[0]?.lines.filter((line) => line.kind === "added")[0]?.text).toContain("= 3");
  const branch = await readDiff({ staged: false, base: "main" }, repo);
  expect(branch.hunks.map((hunk) => hunk.file)).toEqual(["app.ts", "committed.ts"]);
});

test("unborn repositories and quoted UTF-8 paths preserve added line locations", async () => {
  const filename = 'café "quoted"\tfile.ts';
  const repo = await repository("first\nsecond\n", filename, false);
  for (const staged of [false, true]) {
    const diff = await readDiff({ staged }, repo);
    expect(diff.hunks[0]?.file).toBe(filename);
    expect(diff.hunks[0]?.lines[1]).toMatchObject({ kind: "added", oldLine: null, newLine: 2, text: "second" });
  }
});

test("repository diff formatting settings cannot corrupt paths or line markers", async () => {
  const repo = await repository();
  await git(["config", "diff.noprefix", "true"], repo);
  await git(["config", "diff.outputIndicatorNew", "!"], repo);
  await git(["config", "diff.outputIndicatorOld", "?"], repo);
  await writeFile(join(repo, "app.ts"), "export const value = 2;\n");
  const diff = await readDiff({ staged: false }, repo);
  expect(diff.hunks[0]?.file).toBe("app.ts");
  expect(diff.hunks[0]?.lines.filter((line) => line.kind === "added")[0]?.text).toContain("= 2");
});

test("renames retain old and new paths; deletions preserve old line numbers", async () => {
  const repo = await repository("one\ntwo\nthree\nfour\nfive\nsix\n");
  await git(["mv", "app.ts", "renamed.ts"], repo);
  await writeFile(join(repo, "renamed.ts"), "one\ntwo\nTHREE\nfour\nfive\nsix\n");
  const diff = await readDiff({ staged: false }, repo);
  expect(diff.hunks[0]).toMatchObject({ file: "renamed.ts", oldFile: "app.ts" });
  expect(diff.hunks[0]?.lines.find((line) => line.kind === "removed")).toMatchObject({ oldLine: 3, newLine: null, text: "three" });
  await git(["reset", "--hard", "HEAD"], repo);
  await rm(join(repo, "app.ts"));
  expect((await readDiff({ staged: false }, repo)).hunks[0]?.lines.every((line) => line.kind === "removed")).toBe(true);
});

test("compiled CLI sends typed questions and produces actionable, machine-readable findings", async () => {
  const repo = await repository();
  await writeFile(join(repo, "app.ts"), "db.query(`SELECT * FROM users WHERE id = ${request.query.id}`);\n");
  const api = service("injection");
  const result = await run(repo, ["--json"], api.env);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("");
  const report: Report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ complete: true, models: ["jev-test"], reviewedHunks: 1 });
  expect(report.findings[0]).toMatchObject({ rule: "injection", category: "security", file: "app.ts", line: 1, side: "new", probability: 0.97 });
  expect(report.findings[0]?.fix).toContain("parameterized");
  expect(report.findings[0]?.excerpt.some((line) => line.text.includes("db.query"))).toBe(true);
  expect(api.requests).toHaveLength(1);
  expect(api.requests[0]?.model).toBe("jev-latest");
  expect(Object.keys(api.requests[0]!.questions)).toHaveLength(rules.length * 2);
  const human = await run(repo, [], api.env);
  expect(human.stdout).toContain("[HIGH]");
  expect(human.stdout).toContain("app.ts:1");
  expect(human.stdout).toContain("Why:");
  expect(human.stdout).toContain("Fix:");
});

test("removed safeguards are reported on the old side, and terminal control characters are escaped", async () => {
  const repo = await repository("requireAdmin(user);\nperformAction();\n");
  await writeFile(join(repo, "app.ts"), "performAction();\n// \x1b[31m control\n");
  const api = service("access-control", "removed");
  const result = await run(repo, [], api.env);
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("app.ts:1 (old version, removed line)");
  expect(result.stdout).not.toContain("\x1b");
});

for (const fixture of slopCases) {
  test(`compiled CLI includes and reports ${fixture.rule} judgments`, async () => {
    const repo = await repository(`${fixture.before}\n`, fixture.file);
    await writeFile(join(repo, fixture.file), `${fixture.problematic}\n`);
    const api = service(fixture.rule);
    const result = await run(repo, ["--json"], api.env);
    expect(result.code).toBe(1);
    const report: Report = JSON.parse(result.stdout);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ rule: fixture.rule, file: fixture.file, side: "new" });
    const question = api.requests[0]?.questions[fixture.rule];
    expect(question?.type).toBe("noul");
    expect(JSON.stringify(question?.instructions)).toContain(rules.find((rule) => rule.id === fixture.rule)!.condition);
    expect(report.findings[0]?.why.length).toBeGreaterThan(0);
    expect(report.findings[0]?.fix.length).toBeGreaterThan(0);
    if (fixture.rule === "duplicate-logic") {
      expect(report.findings[0]?.duplicateOf).toMatchObject({ file: fixture.file, line: 1 });
      expect(report.findings[0]?.line).toBe(2);
      expect(api.requests).toHaveLength(2);
      expect(api.requests[1]?.state).not.toHaveProperty("before");
      expect(api.requests[1]?.model).toBe("jev-test");
      expect((await run(repo, [], api.env)).stdout).toContain("Other copy: format.ts:1");
    }
  });
}

test("a strong issue judgment without changed-line evidence is not reported", async () => {
  const fixture = slopCases.find((fixture) => fixture.rule === "api-contract")!;
  const repo = await repository(`${fixture.before}\n`, fixture.file);
  await writeFile(join(repo, fixture.file), `${fixture.legitimate}\n`);
  const api = service(fixture.rule, "added", 0.99, false);
  const result = await run(repo, ["--json"], api.env);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).findings).toEqual([]);
});

test("a duplicate finding cannot use the removed implementation as its evidence", async () => {
  const repo = await repository('export const label = name.trim();\n');
  await writeFile(join(repo, "app.ts"), 'export const label = name.trim().toLowerCase();\n');
  const api = service("duplicate-logic", "removed");
  const result = await run(repo, ["--json"], api.env);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).findings).toEqual([]);
});

test("a replacement is not reported as two coexisting implementations", async () => {
  const repo = await repository('export const label = name.trim();\n');
  await writeFile(join(repo, "app.ts"), 'export const label = name.trim().toLowerCase();\n');
  const api = service("duplicate-logic");
  const result = await run(repo, ["--json"], api.env);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).findings).toEqual([]);
});

for (const evidence of ["absent", "same", "old"] as const) {
  test(`duplicate verification rejects ${evidence} peer evidence`, async () => {
    const fixture = slopCases.find((fixture) => fixture.rule === "duplicate-logic")!;
    const repo = await repository(`${fixture.before}\n`, fixture.file);
    await writeFile(join(repo, fixture.file), `${fixture.problematic}\n`);
    const api = service(fixture.rule, "added", 0.97, true, evidence);
    const result = await run(repo, ["--json"], api.env);
    expect(api.requests).toHaveLength(2);
    expect(result.code).toBe(evidence === "absent" ? 0 : 2);
    expect(JSON.parse(result.stdout).findings ?? []).toEqual([]);
  });
}

test("Jev receives separate old and new code, with unambiguous source locations", async () => {
  const repo = await repository('const label = name.trim();\nexport { label };\n');
  await writeFile(join(repo, "app.ts"), 'const label = name.trim().toLowerCase();\nexport { label };\n');
  const api = service();
  await run(repo, ["--json"], api.env);
  const state = api.requests[0]?.state as ReviewState;
  expect(state.before).toEqual([
    { id: "old:1", line: 1, text: "const label = name.trim();" },
    { id: "old:2", line: 2, text: "export { label };" },
  ]);
  expect(state.after).toEqual([
    { id: "new:1", line: 1, text: "const label = name.trim().toLowerCase();" },
    { id: "new:2", line: 2, text: "export { label };" },
  ]);
  expect(state.changed).toEqual({ added: ["new:1"], removed: ["old:1"] });
});

test("separate hunks preserve absolute line numbers and their own old/new snapshots", async () => {
  const before = Array.from({ length: 50 }, (_, index) => `export const value${index + 1} = ${index + 1};`);
  const repo = await repository(`${before.join("\n")}\n`);
  const after = [...before];
  after[1] = "export const value2 = 200;";
  after[47] = "export const value48 = 4800;";
  await writeFile(join(repo, "app.ts"), `${after.join("\n")}\n`);
  const api = service();
  const result = await run(repo, ["--json"], api.env);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).reviewedHunks).toBe(2);
  expect(api.requests).toHaveLength(2);
  for (const [index, request] of api.requests.entries()) {
    const state = request.state as ReviewState;
    const edited = index === 0 ? 2 : 48;
    expect(state.changed).toEqual({ added: [`new:${edited}`], removed: [`old:${edited}`] });
    for (const line of state.before) expect(line.text).toBe(before[line.line - 1]!);
    for (const line of state.after) expect(line.text).toBe(after[line.line - 1]!);
  }
});

test("threshold suppresses weaker judgments and clean model answers exit zero", async () => {
  const repo = await repository();
  await writeFile(join(repo, "app.ts"), "export const value = 2;\n");
  const api = service("logic-regression", "added", 0.7);
  expect((await run(repo, ["--json"], api.env)).code).toBe(0);
  expect((await run(repo, ["--json", "--threshold", "0.6"], api.env)).code).toBe(1);
  const clean = service();
  expect((await run(repo, [], clean.env)).stdout).toContain("No findings above the reporting threshold");
});

test("binary and oversized changes are explicitly incomplete; no oversized state is sent", async () => {
  const repo = await repository();
  await writeFile(join(repo, "image.bin"), new Uint8Array([0, 1, 2]));
  await git(["add", "."], repo);
  const binaryResult = await run(repo, ["--json"]);
  expect(binaryResult.code).toBe(2);
  expect(JSON.parse(binaryResult.stdout).skipped[0].reason).toContain("binary");
  await writeFile(join(repo, "app.ts"), "line\n".repeat(181));
  const api = service();
  const large = await run(repo, ["--json"], api.env);
  expect(large.code).toBe(2);
  expect(JSON.parse(large.stdout).skipped).toHaveLength(2);
  expect(api.requests).toHaveLength(0);
});

test("missing credentials, service errors, and invalid answers never look like a clean review", async () => {
  const repo = await repository();
  await writeFile(join(repo, "app.ts"), "export const value = 2;\n");
  await writeFile(join(repo, ".env"), "TYPESAFE_API_KEY=must-not-load\n");
  const missing = await run(repo, ["--json"]);
  expect(missing.code).toBe(2);
  expect(JSON.parse(missing.stdout).error).toContain("TYPESAFE_API_KEY");
  for (const status of [401, 200]) {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ secret: "must-not-print", answers: {} }, { status }) });
    servers.push(server);
    const result = await run(repo, ["--json"], { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: server.url.toString() });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).complete).toBe(false);
    expect(result.stdout).not.toContain("must-not-print");
  }
});
