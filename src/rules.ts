interface Rule {
  id: string;
  category: "security" | "bug" | "slop";
  severity: "high" | "medium" | "low";
  title: string;
  condition: string;
  sourceCondition?: string;
  why: string;
  fix: string;
}

export const rules: readonly Rule[] = [
  {
    id: "injection", category: "security", severity: "high", title: "Untrusted input reaches an interpreter",
    condition: "The change newly allows attacker-controlled input into SQL, shell commands, eval, or executable HTML without the appropriate parameterization or escaping. A visible input-to-sink path is required.",
    why: "Untrusted input may be interpreted as commands, queries, or executable markup.",
    fix: "Use parameterized queries, argument arrays, or context-appropriate escaping at the highlighted sink.",
  },
  {
    id: "access-control", category: "security", severity: "high", title: "An access check is missing or weakened",
    condition: "The change removes or bypasses authentication, ownership, tenant isolation, or permission checks on a protected operation. Require visible evidence of a protected resource and the weakened boundary; do not assume omitted middleware is absent.",
    why: "A caller may gain access to another user's data or a protected action.",
    fix: "Enforce authentication and resource-level authorization before performing the operation.",
  },
  {
    id: "secret-exposure", category: "security", severity: "high", title: "Sensitive data may be exposed",
    condition: "The change adds a real-looking credential or private key, or sends credentials, tokens, or sensitive user data to logs, client-visible responses, or an unintended destination. Exclude clearly fake test fixtures, environment variable names, and placeholders.",
    why: "Credentials or private data may become available to unintended readers.",
    fix: "Remove the exposure and redact sensitive values. Revoke any real credential already disclosed.",
  },
  {
    id: "unsafe-io", category: "security", severity: "high", title: "Untrusted input controls a file or network destination",
    condition: "The change newly lets an untrusted caller escape an intended filesystem boundary, fetch internal network resources, or write arbitrary paths. Require a visible untrusted input path and missing boundary validation.",
    why: "A caller may read or overwrite unintended files, or reach private services.",
    fix: "Constrain resolved paths to the allowed directory, or validate destinations and redirects against an explicit allowlist.",
  },
  {
    id: "insecure-default", category: "security", severity: "high", title: "A security safeguard is disabled",
    condition: "The change disables TLS verification, weakens credential hashing or cryptography, broadens a security-sensitive default, or fails open after a security check errors. Require concrete weakening, not a generic preference for more safeguards.",
    why: "The changed default or failure path can undermine an existing security boundary.",
    fix: "Restore the secure default and make security checks deny access on failure.",
  },
  {
    id: "logic-regression", category: "bug", severity: "medium", title: "Changed logic may produce an incorrect result",
    condition: "The change introduces a demonstrable incorrect condition, boundary, return value, or null handling. Require a concrete failing case inferable from the hunk, not hypothetical surrounding code or an intentional behavior change. API contract mismatches and hardcoded test shortcuts have separate checks; do not report those here.",
    why: "A supported input or code path may now return the wrong result or throw unexpectedly.",
    fix: "Check the highlighted condition against its callers and boundary cases, then add a regression test for the failing case.",
  },
  {
    id: "async-resource", category: "bug", severity: "medium", title: "Async work or a resource is mishandled",
    condition: "The change visibly introduces an unawaited operation whose result is required, a race on shared state, unbounded resource growth, or missing cleanup on a reachable path. Exclude deliberate background work and resources with visible ownership elsewhere.",
    why: "Work may finish in the wrong order, fail unnoticed, or leave resources allocated.",
    fix: "Make completion and ownership explicit; await required work and clean up resources on every exit path.",
  },
  {
    id: "hidden-failure", category: "bug", severity: "medium", title: "A failure is disguised as success",
    condition: "The change swallows an actionable exception or substitutes a success-shaped result without exposing the failure to the caller. Exclude documented optional behavior, expected not-found cases, and visible recovery.",
    why: "Callers may continue with invalid data or believe an operation succeeded when it failed.",
    fix: "Propagate the error or return an explicit failure result that callers must handle.",
  },
  {
    id: "placeholder", category: "slop", severity: "medium", title: "Placeholder behavior appears to be a finished implementation",
    sourceCondition: "Production code returns fake results, performs no operation, or unconditionally reports success while claiming to implement visible required behavior. Exclude labeled examples, test doubles, unfinished scaffolding, tests, and input-specific shortcuts covered separately.",
    condition: "The change introduces fake production results, a no-op implementation, or unconditional hardcoded success that pretends to implement required behavior. Exclude tests, clearly labeled test doubles, examples, intentionally unfinished scaffolding, and input-specific test shortcuts (covered separately).",
    why: "The code or test can appear to work without delivering or verifying the intended behavior.",
    fix: "Implement the real behavior or make the unsupported path explicit; test an observable outcome.",
  },
  {
    id: "unnecessary-abstraction", category: "slop", severity: "low", title: "Extra machinery has no visible purpose",
    sourceCondition: "A wrapper or generic abstraction adds indirection without any visible semantic benefit. Require a concrete simplification and sufficient visible usage to establish redundancy. Exclude ordinary modularity and interfaces whose users are outside this excerpt. Duplication and redundant guards have separate checks.",
    condition: "The change adds a clearly redundant wrapper or generic abstraction with no semantic benefit visible in the hunk. Require a concrete simplification; do not flag ordinary modularity or speculate about code outside the diff. Duplicated logic and redundant guards have separate checks; do not report them here.",
    why: "The added indirection or duplication makes the behavior harder to follow and maintain.",
    fix: "Inline the redundant wrapper or remove the unused abstraction while preserving behavior.",
  },
  {
    id: "comment-noise", category: "slop", severity: "low", title: "A comment adds noise or contradicts the code",
    sourceCondition: "A comment merely narrates an obvious statement, contains irrelevant AI-assistant conversation, or contradicts the nearby implementation. Exclude explanations of intent, constraints, tradeoffs, or subtle behavior.",
    condition: "An added comment merely narrates an obvious statement, contains irrelevant AI-assistant conversation, or contradicts the implementation beside it. Exclude explanations of intent, tradeoffs, constraints, or subtle behavior.",
    why: "The comment adds reading overhead or gives the reader an inaccurate understanding.",
    fix: "Remove the narration or rewrite the comment to explain the actual reason or constraint.",
  },
  {
    id: "duplicate-logic", category: "slop", severity: "low", title: "Code duplicates an existing implementation",
    sourceCondition: "Two distinct nontrivial implementations of the same operation coexist in this source excerpt, differing only in names or constants. Both copies must be visible. Exclude calls to shared helpers, generated code, independently specified business rules, and similar test setup for different behavior.",
    condition: "An added block copies a nontrivial operation already available in the resulting code shown in this hunk, differing only in names or constants. Both copies must coexist after the change. Exclude moved or replaced code, generated files, independently specified business rules, and repeated test setup with different behavior.",
    why: "The same behavior now has multiple implementations that can drift when one is fixed or extended.",
    fix: "Reuse the existing operation, passing the small differences as arguments where appropriate.",
  },
  {
    id: "redundant-guard", category: "slop", severity: "low", title: "A defensive branch cannot be reached",
    sourceCondition: "A guard or fallback handles a state already ruled out by visible executable code. Type annotations alone are not proof. Exclude external-input validation, mutable values that may change between checks, and real recovery paths.",
    condition: "An added guard or fallback handles a state already ruled out by a visible runtime check, literal construction, or unconditional control flow. Require proof from executable code, not just a type annotation. Exclude validation of external input, mutable values that may change between checks, and recovery from a real failure.",
    why: "The extra branch suggests a possible state that this code cannot actually reach.",
    fix: "Remove the unreachable branch and keep validation at the point that establishes the invariant.",
  },
  {
    id: "type-check-bypass", category: "slop", severity: "medium", title: "A type escape hides a visible mismatch",
    sourceCondition: "A type escape, double assertion, non-null assertion, or checker suppression hides a concrete incompatible value or possible null access visible here. Exclude const assertions, negative type tests, justified interop, and narrowing backed by runtime checks. A cast alone is not evidence.",
    condition: "The change adds a broad type escape, double assertion, non-null assertion, or checker suppression that hides a concrete incompatible value or possible null access visible in this hunk. Exclude const assertions, negative type tests, justified interop boundaries, and narrowing backed by a visible runtime check. A cast or suppression alone is not evidence.",
    why: "The checker accepts a value without correcting the mismatch or making the runtime operation safe.",
    fix: "Correct the value or contract, or validate and narrow it before use instead of suppressing the mismatch.",
  },
  {
    id: "test-weakening", category: "slop", severity: "medium", title: "A test or check is weakened without replacing its coverage",
    condition: "The change replaces a substantive assertion with a vacuous one, skips a still-relevant regression test, or forces a test/lint/typecheck command to succeed despite failure. Require the removed guarantee or bypassed failure to be visible. Exclude equivalent assertions, explicit requirement changes, relocated coverage visible here, and documented temporary quarantines with a concrete issue reference.",
    why: "The checks can pass while behavior they previously protected is broken.",
    fix: "Restore the meaningful assertion or failing exit status and fix the underlying behavior; preserve coverage when updating requirements.",
  },
  {
    id: "self-fulfilling-test", category: "slop", severity: "medium", title: "A test verifies its own setup instead of production behavior",
    sourceCondition: "A test only checks the configured result of a mock of the subject itself, compares a result with itself, or uses the same production call for actual and expected. Require a visibly circular check. Exclude dependency mocks, interaction tests invoking the real subject, and independent reference implementations.",
    condition: "An added test mocks the very operation it claims to verify and only checks that mock's configured return, compares a result with itself, or computes expected and actual through the identical production call. Require the lack of an independent behavioral check to be visible. Exclude legitimate dependency mocks, interaction tests that invoke the real subject, and independent reference implementations. Weakened existing assertions are covered separately.",
    why: "The test can stay green even if the intended production behavior is removed or broken.",
    fix: "Invoke the real subject and compare its observable result with an independently specified expectation; mock only its dependencies.",
  },
  {
    id: "api-contract", category: "bug", severity: "medium", title: "An API call contradicts the visible contract",
    condition: "An added call uses a method, argument, option, or result field contradicted by the complete relevant declaration, implementation, or schema shown in this hunk. Require affirmative contract evidence, not simply an absent definition or an unfamiliar name. Exclude dynamic extension points, omitted overloads, private packages, and guesses based on remembered third-party documentation. Never infer that a package does not exist from its name.",
    why: "The call relies on an interface the visible implementation does not provide, so it may fail or ignore the requested behavior.",
    fix: "Use the actual method, argument, or result shape defined by the contract; verify external APIs against the installed version.",
  },
  {
    id: "hardcoded-test-case", category: "slop", severity: "medium", title: "A special case substitutes a test answer for real behavior",
    sourceCondition: "Production logic returns a canned answer for a test/example input, fixture name, or test-runner signal instead of performing the visible general-purpose contract. Exclude valid base cases, specified business rules, caches that compute misses, and explicitly injected test implementations.",
    condition: "Production logic is changed to return a canned result for a visible test/example input, fixture name, or test-runner signal, bypassing the general computation. Require a visible general-purpose contract or test linkage; ordinary constants are not evidence. Exclude mathematically valid base cases, specified business rules, caches that compute misses, and explicitly injected test implementations.",
    why: "The example can pass while the general implementation remains incorrect for other supported inputs.",
    fix: "Implement the general rule and cover inputs beyond the example; keep test substitutes outside the production decision path.",
  },
];
