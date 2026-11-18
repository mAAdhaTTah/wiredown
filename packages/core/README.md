# @wiredown/core

Wiredown's parser, variant resolution, layout and text metrics. It has no DOM
and no Excalidraw dependency: layout turns a text spec into positioned draw
operations, and text measuring is injected by the host.

## Fork notice

This package is a fork of the core of
[Sketchdown](https://github.com/magnushaggren/sketchdown) by Magnus Haggren,
at commit `e790382`, used under the MIT licence. The upstream copyright
notice is preserved in this package's [LICENSE](LICENSE).

`tests/fixtures/prototype/Sketchdown.md` is Sketchdown's original
single-script prototype, kept unchanged because the compatibility test runs
its parser against the v2 fixture specs.
