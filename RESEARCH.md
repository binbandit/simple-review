# AI slop review patterns

Research reviewed September 21, 2026. These are code-quality checks, not authorship detection. Evidence from a particular model, benchmark, or observational dataset does not establish a universal prevalence rate. The exact review conditions and exceptions are our engineering choices; the papers do not validate this CLI or Jev's accuracy.

## Sources and interpretation

- [GitClear's 2025 code-quality study](https://www.gitclear.com/ai_assistant_code_quality_2025_research) reports increased copying and reduced reuse in its change dataset. That motivates a dedicated duplication check, but the aggregate trend does not establish that a particular copied block was AI-generated.
- [SlopCodeBench](https://arxiv.org/abs/2603.24755) studies quality deterioration during repeated agent edits. Its [appendix B.2](https://arxiv.org/html/2603.24755v1) includes prompt guidance about defensive overengineering and escaping type checks. These motivate review candidates; inclusion in a prompt is not evidence of each pattern's frequency or of successful detection.
- [TypeScript's handbook](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions) explains that assertions do not perform runtime validation. We therefore require a visible unsafe assumption before reporting a type escape.
- [Anthropic's reward-hacking research](https://www.anthropic.com/research/emergent-misalignment-reward-hacking) demonstrates test-harness shortcuts in a controlled training setup. Our test-weakening and hardcoded-answer rules target the observable shortcuts, without inferring intent or claiming these experiment rates describe normal development.
- [Understanding and Characterizing Mock Assertions in Unit Tests](https://valerio-terragni.github.io/assets/pdf/zhu-fse-2025.pdf) examines mock assertions and discusses aggressive mocking in automatic test generation. Our narrower self-fulfilling-test rule requires that the purported subject itself is mocked or that the expectation is circular. Ordinary dependency mocks remain useful.
- [LLM Hallucinations in Practical Code Generation](https://arxiv.org/abs/2409.20550) identifies conflicts with APIs and project context. We report only contradictions with contracts visible in the hunk, so unfamiliar APIs are not automatically suspect.
- [We Have a Package for You!](https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen) establishes package hallucinations as a supply-chain concern. Registry and installed-dependency verification are outside this diff-only tool; we deliberately do not label unknown package names as hallucinated.

## Added checks

| Rule ID | Required evidence | Important exception |
| --- | --- | --- |
| `duplicate-logic` | Two implementations coexist in the resulting hunk | Moves and replacements are not duplicates |
| `redundant-guard` | Executable code already rules out the branch | Types alone do not prove external data is valid |
| `type-check-bypass` | A new type escape conceals a concrete mismatch | Validated narrowing and negative type tests |
| `test-weakening` | A visible assertion or failure signal is removed without equivalent coverage | Requirement changes and documented quarantines |
| `self-fulfilling-test` | A test only confirms its mock setup or a circular expectation | Real subjects using mocked dependencies |
| `api-contract` | A call contradicts the visible declaration or implementation | Unknown packages and definitions outside the hunk |
| `hardcoded-test-case` | A canned example answer replaces general behavior | Valid base cases and specified business rules |

Existing generic rules were narrowed to reduce overlapping findings. Existing checks still cover security regressions, hidden failures, placeholders, redundant wrappers, and misleading comments. We avoid rules based solely on length, naming style, helper count, comments, or the presence of a cast.

## Verification

`just check` tests the command and its request/report behavior against simulated answers. It cannot establish semantic detection quality.

`just eval` sends 14 authored examples (one problematic change and one legitimate counterpart per added rule) through the real review path at the default 0.85 threshold. It requires an exported `TYPESAFE_API_KEY` and uses API credits. Each case checks whether its target rule is reported; legitimate counterparts may still trigger unrelated rules. Output records the responding model and reported findings. This is a small regression set, not a representative accuracy benchmark.

The initial live evaluation has not been run because no TypeSafe API key was available during development. Use it before relying on the new rules to block changes, and expand the examples with actual false positives and missed issues.
