# @wiredown/evals

A manual eval of the screen syntax, as planned in the syntax proposal's
["How to test it"](../../docs/prds/initial-implementation/syntax-proposal.md#how-to-test-it):
the fork before the proposal ("old") against the fork after it ("new"),
with the model expected to author screens. It is never part of `pnpm test`
or CI, and it costs money (or subscription usage) each time it runs.

> **Limitation: the PRD is synthetic.** The proposal asks for a real
> product's PRD. None was available, so `fixtures/prd.md` is a PRD written
> for this eval (scheduled report exports in a fictional analytics app). It
> is deliberately not the team-members example that both syntax references
> and the skill use. Point the eval at a real PRD with `WIREDOWN_EVAL_PRD`
> (see below) before drawing conclusions about the syntax.

## What it measures

Two arms, each a parser and the syntax reference given to the model:

- **new**: the current `@wiredown/core` (`checkScreens`) and the skill's
  syntax reference: [`reference/syntax.md`](../../skills/wiredown/reference/syntax.md)
  followed by each file in `reference/components/`.
- **old**: the fork's parser as first imported into this repo, at commit
  `c36f5df` (`BASELINE_SHA` in [`src/baseline.ts`](src/baseline.ts)), and
  [`fixtures/old/syntax.md`](fixtures/old/syntax.md): a trimmed copy of the
  prototype's `docs/SYNTAX.md` (MIT, attribution kept) with an appendix on
  the fork's additions (`(id=…)`, `//`, `(hi)`, `>` rows, `extends:`,
  implicit replacement, `remove:`, `after:`/`before:`, `rows:`). The
  appendix's claims and every example are checked against the baseline
  parser in `tests/references.test.ts`.

The references are comparable in size as given to the model (leading HTML
comments stripped): old 14.6 kB / about 2,470 words, new 15.4 kB / about
2,380 words; a test keeps them within 20% of each other. They differ in
shape: the new one is generated from core's catalog with a section per
component and its allowed options; the old one is the prototype's prose and
one components table. Both end with a worked variant example.

Three tasks per arm and run, each with a fix loop:

1. **Screens from prose**: write `screens.md` with five named screens
   (block ids given) from the PRD.
2. **Variant**: given a base screen in the arm's syntax
   (`fixtures/<arm>/variant-base.md`) and a one-line change, write the
   variant block.
3. **Reviewer comment**: given a screens file in the arm's syntax
   (`fixtures/<arm>/review.md`) and the comment "show the failed state on
   row 3; mark the Recipients column as unclear", return the revised file.

The model must reply with only the file in one four-backtick fence; any
other reply is a failed attempt. The output is checked with the arm's
parser; on errors the findings go back to the model, formatted as
`wiredown check` prints them (`screens.md:12: ^id: error: …`, errors only),
with its previous file, up to the cap of fix rounds. The baseline has no
`checkScreens`, so the old arm runs the current `checkScreens` with the
baseline's `resolve` as its block checker
([`src/arms.ts`](src/arms.ts)): scanning, `^ids` and every file-level
finding (no id, invalid or duplicate id, unclosed fence) are the same code
in both arms, and a parity test holds them equal. Only the block parser
differs.

Recorded per task, arm and run (`results.json`):

- `check` errors on the first attempt, and whether it was clean;
- fix rounds to a clean check (`null` when the cap was reached);
- non-blank lines of the final output, and the diff size against the input
  (added + removed non-blank lines; task 3, and task 2 where it is the
  appended block);
- `structureOk`, a structural check only: task 1 has all five ids; task 2
  has a block with the new id whose first line extends the base; task 3
  changed the file and kept every screen id;
- wall time, tokens and cost as `claude -p --output-format json` reports
  them; every prompt and reply.

The vitest-evals reporter shows four 0–1 scores per test: `CleanFirstAttempt`,
`CleanWithinCap`, `FixEfficiency` (1 / (1 + fix rounds)) and `StructureOk`.
They are measures, not pass/fail (`judgeThreshold: null`); a test fails only
when the pipeline itself breaks.

**The eval does not judge whether the requested change was made
correctly.** A clean check and `structureOk` say the file parses and has the
right screens; a task-3 reply that only edits a heading passes both. Whether
the variant shows the paused state, or the revision addresses the comment,
is for the human rating sheet (below). There is no automated content judge.

## Running it

```sh
pnpm build                      # the new arm imports core's dist
pnpm eval                       # from the repository root
WIREDOWN_EVAL_MODEL=haiku WIREDOWN_EVAL_RUNS=1 WIREDOWN_EVAL_CAP=2 pnpm eval
```

| Variable                    | Default                  | Meaning                                           |
| --------------------------- | ------------------------ | ------------------------------------------------- |
| `WIREDOWN_EVAL_MODEL`       | `sonnet`                 | `--model` for `claude -p` (an alias or full name) |
| `WIREDOWN_EVAL_RUNS`        | `2`                      | runs per task and arm                             |
| `WIREDOWN_EVAL_CAP`         | `3`                      | fix rounds after the first attempt                |
| `WIREDOWN_EVAL_CONCURRENCY` | `2`                      | runs in flight at once                            |
| `WIREDOWN_EVAL_TIMEOUT_MS`  | `300000`                 | per `claude -p` call                              |
| `WIREDOWN_EVAL_PRD`         | `fixtures/`              | a PRD file, or a material directory (see below)   |
| `WIREDOWN_EVAL_RESULTS`     | `packages/evals/results` | where result directories go                       |
| `WIREDOWN_EVAL_SEED`        | the run's timestamp      | seed of the rating sheet's A/B order              |

The model is called through the headless Claude Code CLI, so it runs on
the logged-in subscription with no API key:

```sh
claude -p --model <model> --output-format json --tools "" --safe-mode \
  --no-session-persistence --system-prompt "<short instruction>"
```

with the prompt on stdin, in a fresh empty temp directory. `--tools ""`
leaves the model nothing but text; `--safe-mode` skips CLAUDE.md, skills,
plugins, hooks and MCP servers; the empty directory keeps this repo's
`AGENTS.md`, `CLAUDE.md` and skill out of the session, so the only syntax
the model sees is the arm's reference. Variables that tie a process to a
parent Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, the
messaging socket and so on) are removed, so the eval also runs from inside
a Claude Code session; the login (`CLAUDE_CONFIG_DIR`) is kept. Before the
tasks, one trivial call checks that `claude -p` works and fails the whole
run with claude's own message if it does not (not logged in, unknown
model, not on PATH). A non-zero exit, a timeout or an empty reply during a
task is a failed attempt that counts against the cap.

The old arm's parser is built on first use: `git archive c36f5df` of
`packages/core` and `tsconfig.base.json` into
`node_modules/.cache/wiredown-evals/`, compiled with the repo's `tsc`. No
network is needed, but the commit must be in the clone. The tag
`eval-baseline` points at it; in a shallow clone, or one without the stack's
branches, run `git fetch origin tag eval-baseline`. The unit tests that need the
baseline skip when the commit is missing, as in CI's depth-1 checkout.

### Cost and time

Smoke runs (pipeline checks only, not findings about the syntax): `haiku`,
1 run per task and arm, cap 2, concurrency 2. Six runs took 23–27 s of wall
time and $0.007–0.013 in total (the lower figure with a warm prompt cache);
each call sent 7–9k input tokens, most of them the syntax reference, plus
the PRD for task 1. Fix rounds resend the task with the previous file, so a
run costs up to (1 + cap) calls. With Sonnet, the default 2 runs and cap 3,
expect 12 runs of 1–4 calls each, a few minutes, and several times Haiku's
cost per call.

### A real PRD

`WIREDOWN_EVAL_PRD` takes a material directory laid out like `fixtures/`,
or a PRD file inside one (which then replaces the PRD that
`material.json` names):

```text
material.json        screens for task 1; the variant (base, id, change); the review comment
prd.md
old/variant-base.md  task 2's base screen, in the old syntax
new/variant-base.md  the same screen in the new syntax
old/review.md        task 3's screens file, in the old syntax
new/review.md        the same file in the new syntax
```

Write the old and new inputs as the same screens, each idiomatic in its
syntax; the eval refuses to start when an input does not check clean in
its own arm.

## Results

Each run writes `results/<timestamp>/` (ignored by git):

- `results.json`: the configuration, the summary rows and every run with
  its attempts (prompts, replies, findings, timings, usage);
- `summary.md`: the comparison table, means per task and arm and over all
  tasks (also printed at the end of the run);
- `rate.md` and `key.json`: the blind rating sheet and its key.

## Blind readability rating

`rate.md` has one case per run of tasks 2 and 3: the two arms' outputs as
"A" and "B", each a unified diff against that arm's input, in a seeded
random order. Write `A`, `B` or `same` after each `Case N, more readable
(A / B / same):` line without opening `key.json`, then reveal and tally:

```sh
pnpm eval:reveal packages/evals/results/<timestamp>
```

The labels are hidden, but the syntax itself shows (`(id=…)` against
`#id`), so a rater who knows both can tell them apart; ask someone who does
not, or treat the rating as a readability judgement rather than a blind
one.

## Limitations

- The PRD is synthetic (see the top), and the task 2 and 3 inputs were
  written for it by the same author as the references.
- N is small: two runs per task and arm by default. Differences of one
  error or one round are noise at this size.
- The old arm's reference is a trimmed, vendored copy of the prototype's
  doc with an appendix written for this eval, not the doc the fork's users
  had; the new one is generated from the catalog. Documentation quality is
  mixed into the result.
- One model family (Claude through `claude -p`), one prompt wording, no
  tools: the model can't run `check` or render itself, unlike an agent
  using the skill.
- `check` clean is not the same as a good screen, and `structureOk` is
  structural only; only the human rating looks at the content.
- The baseline is pinned by its SHA; the tag `eval-baseline` points at the
  same commit so it survives a squash merge of the stack. In a clone
  without it, run `git fetch origin tag eval-baseline`.
