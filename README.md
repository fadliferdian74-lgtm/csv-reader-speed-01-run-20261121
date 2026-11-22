# Fast CSV Reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/fadliferdian74-lgtm/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/fadliferdian74-lgtm/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A dependency-free CSV reader for Node that returns, for every input, exactly the
answer csv-reader 1.0.0 returns — `{columns, rows, errors}` for an input
`{text, header}`, including its full broken-row policy (stray CRs, junk after a
closing quote, unterminated quotes, short and long rows) — only faster.

## How it works

`solve.js` exports `run(input)`. It reads the text once, left to right:

- A whole record that sits on one line with no CR and no quote at a field start
  is answered by a single comma split of the line.
- Every other field is cut out with `indexOf`-guided slices instead of
  character-by-character string joins.
- Only the rare broken shapes — a stray CR in an unquoted field, CRs inside a
  quoted field, junk after a closing quote — fall back to a character loop.

`main.ts` is the harness driver: it reads every case from `/input/cases.json`,
answers each with `run`, and writes `/output/answers.json`.

## Layout

- `main.ts` — the driver the harness runs (`node main.ts`).
- `solve.js` — the reader itself, an ES module with no dependencies.
- `LICENSE` — MIT.
