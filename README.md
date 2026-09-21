# review

A small Bun CLI that asks [TypeSafe's Jev](https://docs.typesafe.ai/) to flag potential security regressions, bugs, and AI slop in your Git diff.

## Install

Requires Bun, Git, and [just](https://just.systems/).

```sh
just build                   # standalone executable at dist/review
just install                 # build and install to ~/.local/bin/review
just install /usr/local/bin   # optional destination (must be writable)
export PATH="$HOME/.local/bin:$PATH"
export TYPESAFE_API_KEY="your-key"
```

Get an API key from the [TypeSafe console](https://console.typesafe.ai). The compiled executable requires Git at runtime; it does not require Bun or Node. It does not load the reviewed repository's `.env` or `bunfig.toml`. Export credentials in your shell.

## Use

```sh
review                        # staged + unstaged tracked changes against HEAD
review --staged                # index only
review --base main             # merge base with main through the current working tree
review --json                  # structured output for agents and scripts
review --threshold 0.9         # report only higher-probability issues (default: 0.85)
```

Run from anywhere inside a Git working tree. New files must be staged with `git add` to appear in the diff. `--staged` and `--base` are mutually exclusive. Repositories without an initial commit are supported. Resolve merge conflicts before reviewing.

Example output (illustrative):

```text
review | tracked changes against HEAD
1 hunk reviewed across 1 changed file

[HIGH] Untrusted input reaches an interpreter
  src/users.ts:42 | security/injection | model probability 97%
  >    42 + db.query(`SELECT * FROM users WHERE id = ${request.query.id}`);
  Why: Untrusted input may be interpreted as commands, queries, or executable markup.
  Fix: Use parameterized queries, argument arrays, or context-appropriate escaping at the highlighted sink.

1 potential issue. Verify the evidence before changing code.
```

Findings are sorted by severity, file, and line. Each includes a stable rule ID, changed-line location, source excerpt, explanation, and suggested fix. Removed lines are labeled as locations in the old version.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | No findings above the threshold |
| 1 | Potential issues found |
| 2 | Error or incomplete review, including skipped changes |

`--json` emits one JSON object to stdout with no progress messages. Reports contain `version`, `scope`, `root`, actual `models`, `threshold`, `files`, `reviewedHunks`, `complete`, `skipped`, and `findings`. Each finding contains `rule`, `category`, `severity`, `title`, `file`, `line`, `side`, `probability`, `locationProbability`, `why`, `fix`, and `excerpt`. File paths are relative to `root`; line numbers are one-based. Use `side` to distinguish old and new versions. Errors emit `{ "version": 1, "complete": false, "error": "..." }` and exit 2; partial findings are not returned on a service failure.

## What it checks

- Security: injection, weakened access control, credential exposure, unsafe file/network destinations, disabled safeguards.
- Bugs: incorrect logic, async/resource mistakes, failures disguised as success, API calls that contradict a visible contract.
- Slop: fake implementations, needless abstraction, duplicate logic, unreachable defensive branches, type-check bypasses, weakened or self-fulfilling tests, hardcoded test answers, and comments that narrate or contradict the code.

See [research and rule boundaries](RESEARCH.md) for sources, required evidence, and legitimate exceptions. Unknown package names are not treated as hallucinations: the CLI does not query package registries.

“Slop” describes concrete code problems, not who wrote the code. The checks explicitly exclude speculative complaints and problems that already existed before the change.

Jev returns typed judgments, not freeform explanations. For each hunk, one request asks all eighteen issue-presence questions and eighteen speculative line-selection questions together. A finding requires an issue probability at or above the threshold and a selected changed line. The explanation, suggested fix, and severity come from the selected rule in [src/rules.ts](src/rules.ts); they are general guidance, not a generated diagnosis of your exact program. Line-selection probability is preserved separately in JSON.

## Scope and limits

The CLI sends each text diff hunk, its file paths, and eight surrounding context lines to the configured TypeSafe API. It does not send the full repository. Hunks are evaluated independently, so cross-file and distant context may be missed. It reports at most one finding per rule per hunk and can miss other types of problems. Findings can be wrong, and no findings is not proof that a change is safe.

The initial 0.85 threshold is a conservative reporting default, not an empirically calibrated guarantee. Model probabilities describe Jev's judgments, not measured detection accuracy. Evaluate it on your own changes before using exit codes to gate merges.

Hunks over 180 changed lines or 20 KB of serialized state are skipped instead of truncated. Binary files, submodules, pure renames, and mode-only changes are also explicitly skipped, making the review incomplete. Split oversized changes into smaller hunks when needed.

`TYPESAFE_DEFAULT_MODEL` selects a Jev version; the default is `jev-latest`. `TYPESAFE_BASE_URL` overrides the API endpoint, including for local integration tests. Requests use the SDK's bounded retries and a 60-second total deadline per hunk. Nothing is executed from the diff, and Git external diff/text conversion helpers are disabled.

## Development

```sh
bun install
just check   # strict TypeScript check + compiled-CLI integration tests
just eval    # optional: 14 live Jev examples; requires an exported API key, uses API credits
```

Normal tests use temporary Git repositories and a local simulated TypeSafe API. They exercise the compiled command, diff scopes, filenames, deletions, renames, API request/response handling, thresholds, exit codes, new rule reporting, and incomplete coverage. They do not measure live Jev accuracy. The separate `just eval` command checks each new rule against a problematic example and a legitimate counterpart; it is not part of `just check`.
