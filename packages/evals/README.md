# @wiredown/evals

A manual eval of how well a model writes wiredown screens from the skill's
syntax reference. It is never part of `pnpm test` or CI, and it costs money
(or subscription usage) each time it runs.

It is a start: the model gets the reference as text, with no tools, and is
scored on whether its screens check clean. Evaluating the whole workflow (an
agent using the skill and the CLI to produce flows, judged against a quality
bar) is issue #48.

> **Limitation: the PRD is synthetic.** `fixtures/prd.md` is a PRD written
> for this eval (scheduled report exports in a fictional analytics app),
> deliberately not the team-members example the skill uses. Point the eval
> at a real PRD with `WIREDOWN_EVAL_PRD` (see below) before drawing
> conclusions.

## What it measures

The model is given the skill's syntax reference:
[`reference/syntax.md`](../../skills/wiredown/reference/syntax.md) followed
by each file in `reference/components/`, without their generated-file notes.

Three tasks per run, each with a fix loop:

1. **Screens from prose**: write `screens.md` with five named screens
   (block ids given) from the PRD.
2. **Variant**: given a base screen (`fixtures/variant-base.md`) and a
   one-line change, write the variant block.
3. **Reviewer comment**: given a screens file (`fixtures/review.md`) and the
   comment "show the failed state on row 3; mark the Recipients column as
   unclear", return the revised file.

The model must reply with only the file in one four-backtick fence; any
other reply is a failed attempt. The output is checked with core's
`checkScreens`; on errors the findings go back to the model, formatted as
`wiredown check` prints them (`screens.md:12: ^id: error: …`, errors only),
with its previous file, up to the cap of fix rounds. The baseline has no
`checkScreens`, so the old arm uses `checkScreensInternal` from core's
source (`../../core/src/internal.ts`) with the baseline's
`resolve` as its block checker
([`src/arms.ts`](src/arms.ts)): scanning, `^ids` and every file-level
finding (no id, invalid or duplicate id, unclosed fence) are the same code
in both arms, and a parity test holds them equal. Only the block parser
differs.

Each case records:

- `check` errors on the first attempt, and whether it was clean;
- fix rounds to a clean check (`null` when the cap was reached);
- non-blank lines of the final output, and the diff size against the input
  (added + removed non-blank lines; task 3, and task 2 where it is the
  appended block);
- `structureOk`, a structural check only: task 1 has all five ids; task 2
  has a block with the new id whose first line extends the base; task 3
  changed the file and kept every screen id;
- the final file, every prompt and reply, wall time, tokens and cost as
  `claude -p --output-format json` reports them.

The vitest-evals reporter shows two 0–1 scores per case: `FixEfficiency`
(1 when clean on the first attempt, 1 / (1 + fix rounds) after fixes, 0 when
not clean within the cap) and `StructureOk`. They are measures, not
pass/fail (`judgeThreshold: null`); a case fails only when the pipeline
itself breaks.

**The eval does not judge whether the requested change was made
correctly.** A clean check and `structureOk` say the file parses and has the
right screens; a task-3 reply that only edits a heading passes both. Read
the final files in the results to judge the content.

## Running it

```sh
pnpm build                      # the eval and its unit tests import core's dist
pnpm eval                       # from the repository root
WIREDOWN_EVAL_MODEL=haiku WIREDOWN_EVAL_RUNS=1 WIREDOWN_EVAL_CAP=2 pnpm eval
```

| Variable                    | Default                  | Meaning                                           |
| --------------------------- | ------------------------ | ------------------------------------------------- |
| `WIREDOWN_EVAL_MODEL`       | `sonnet`                 | `--model` for `claude -p` (an alias or full name) |
| `WIREDOWN_EVAL_RUNS`        | `2`                      | runs per task                                     |
| `WIREDOWN_EVAL_CAP`         | `3`                      | fix rounds after the first attempt                |
| `WIREDOWN_EVAL_CONCURRENCY` | `2`                      | runs in flight at once                            |
| `WIREDOWN_EVAL_TIMEOUT_MS`  | `300000`                 | per `claude -p` call                              |
| `WIREDOWN_EVAL_PRD`         | `fixtures/`              | a PRD file, or a material directory (see below)   |
| `WIREDOWN_EVAL_RESULTS`     | `packages/evals/results` | where result directories go                       |

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
the model sees is the reference in the prompt. Variables that tie a process
to a parent Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, the
messaging socket and so on) are removed, so the eval also runs from inside
a Claude Code session; the login (`CLAUDE_CONFIG_DIR`) is kept. Before the
tasks, one trivial call checks that `claude -p` works and fails the whole
run with claude's own message if it does not (not logged in, unknown
model, not on PATH). A non-zero exit, a timeout or an empty reply during a
task is a failed attempt that counts against the cap.

### Cost

Fix rounds resend the task with the previous file, so a run costs up to
(1 + cap) calls, plus the one trivial call at the start. With the defaults
(2 runs, cap 3) that is 6 runs of 1–4 calls each. Each call sends the
reference (most of its input tokens), plus the PRD for task 1.
One run per task on `haiku` with cap 2 took 17 s and about $0.01.

### A real PRD

`WIREDOWN_EVAL_PRD` takes a material directory laid out like `fixtures/`,
or a PRD file inside one (which then replaces the PRD that
`material.json` names):

```text
material.json     screens for task 1; the variant (base, id, change); the review comment
prd.md
variant-base.md   task 2's base screen
review.md         task 3's screens file
```

The eval refuses to start when `variant-base.md` or `review.md` does not
check clean.

## Results

Each run writes Vitest's JSON report to `results/<timestamp>/results.json`
(ignored by git): every case's measures, scores, final file, prompts,
replies and usage. Browse it with:

```sh
pnpm --filter @wiredown/evals exec vitest-evals serve results/<timestamp>/results.json
```

## Limitations

- The PRD is synthetic (see the top), and the task 2 and 3 inputs were
  written for it.
- N is small: two runs per task by default.
- One model family (Claude through `claude -p`), one prompt wording, no
  tools: the model can't run `check` or render itself, unlike an agent
  using the skill.
- `check` clean is not the same as a good screen, and `structureOk` is
  structural only; nothing scores the content.
