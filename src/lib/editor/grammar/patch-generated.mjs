// Post-process antlr-ng's TypeScript output to work around three codegen bugs
// that break runtime ESM import (under strict checkers) and svelte-check.
// No upstream issues track these at https://github.com/antlr-ng/antlr-ng/issues
// as of antlr-ng 1.0.10; we should file them eventually and drop each
// substitution as it's fixed upstream. All substitutions are idempotent.
//
// 1. ParseTreeListener imported as a value
//    ----------------------------------------
//    antlr4ng declares `ParseTreeListener` as `export interface` (see
//    node_modules/antlr4ng/dist/tree/ParseTreeListener.d.ts). antlr-ng doesn't
//    model which antlr4ng exports are types vs values, so it emits a plain
//    value import. That fails under `verbatimModuleSyntax` / strict ESM.
//    Fix: rewrite as `import type { ParseTreeListener }`.
//
// 2. Unqualified `ParserRuleContext` in the `predicate` rule
//    --------------------------------------------------------
//    SqlBase.g4 declares `predicate[ParserRuleContext value]` (line ~569).
//    ANTLR rule arguments embed target-language type syntax verbatim — the
//    Trino grammar is Java-targeted, so the type name is bare. antlr-ng
//    pastes the token through without namespace-qualifying it, even though
//    the generated file does `import * as antlr from "antlr4ng"` and uses
//    `antlr.ParserRuleContext` everywhere else. We can't fix this in the
//    grammar without diverging from Trino upstream (which we sync from).
//    Fix: rewrite the three affected references to `antlr.ParserRuleContext`.
//
// 3. `predicate(value)` parameter should accept undefined
//    -----------------------------------------------------
//    Grammar: `predicate[$valueExpression.ctx]?` — the `?` makes the
//    invocation optional, and at runtime the arg can be undefined. Java
//    ignores this (everything is nullable); TS with strict null checks
//    rejects it. antlr-ng doesn't reflect the optional-invocation nullability
//    in the emitted parameter type. Fix: widen the signature, field, and
//    constructor parameter to `antlr.ParserRuleContext | undefined`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, '..', 'generated');

function patchListener() {
  const path = join(generatedDir, 'SqlBaseListener.ts');
  const before = readFileSync(path, 'utf8');
  const original =
    'import { ErrorNode, ParseTreeListener, ParserRuleContext, TerminalNode } from "antlr4ng";';
  const replacement =
    'import type { ParseTreeListener } from "antlr4ng";\n' +
    'import { ErrorNode, ParserRuleContext, TerminalNode } from "antlr4ng";';
  if (before.includes(replacement)) return;
  if (!before.includes(original)) {
    throw new Error(`patch-generated: could not find listener import in ${path}`);
  }
  writeFileSync(path, before.replace(original, replacement));
  console.log('patched', path);
}

function patchParser() {
  const path = join(generatedDir, 'SqlBaseParser.ts');
  const before = readFileSync(path, 'utf8');
  let after = before;
  // Qualify bare `ParserRuleContext` (not preceded by `.` or a word char) as
  // `antlr.ParserRuleContext`. Lookbehind keeps already-qualified names intact.
  after = after.replace(/(?<![.\w])ParserRuleContext(?!\w)/g, 'antlr.ParserRuleContext');
  // predicate() is called with optional sub-contexts that may be undefined —
  // relax the signature and the PredicateContext field/ctor parameter to
  // allow undefined, consistent with how ANTLR actually passes the value.
  after = after.replace(
    /public predicate\(value: antlr\.ParserRuleContext\): PredicateContext \{/,
    'public predicate(value: antlr.ParserRuleContext | undefined): PredicateContext {'
  );
  after = after.replace(
    /public value: antlr\.ParserRuleContext;/,
    'public value: antlr.ParserRuleContext | undefined;'
  );
  after = after.replace(
    /public constructor\(parent: antlr\.ParserRuleContext \| null, invokingState: number, value: antlr\.ParserRuleContext\) \{\n        super\(parent, invokingState\);\n        this\.value = value;\n    \}/,
    'public constructor(parent: antlr.ParserRuleContext | null, invokingState: number, value: antlr.ParserRuleContext | undefined) {\n        super(parent, invokingState);\n        this.value = value;\n    }'
  );
  if (after === before) return;
  writeFileSync(path, after);
  console.log('patched', path);
}

patchListener();
patchParser();
