// Post-process antlr-ng's TypeScript output to fix two generator bugs that
// block runtime ESM import (under strict checkers) and svelte-check:
//
// 1. SqlBaseListener.ts imports `ParseTreeListener` as a value, but in
//    antlr4ng it is a type-only `interface` — the value import fails under
//    strict ESM. Rewrite it as `import type { ParseTreeListener }`.
//
// 2. SqlBaseParser.ts contains three bare `ParserRuleContext` references that
//    should be qualified as `antlr.ParserRuleContext` (the file already does
//    `import * as antlr from "antlr4ng"` and uses the prefix everywhere else).
//
// Both substitutions are idempotent.

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
