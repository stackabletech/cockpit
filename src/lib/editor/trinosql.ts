// Registers the 'trinosql' language with Monaco Editor using an ANTLR-based tokenizer.
// Based on https://github.com/trinodb/trino-query-ui/blob/fa6a5157058441b0ad318a75c13241f5b9dfc1e0/precise/src/QueryEditorPane.tsx#L678-L701
// Licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0)

import type * as Monaco from 'monaco-editor';
import { CharStream } from 'antlr4ng';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';
import { tokenMap } from './tokenMap';
import { createCompletionProvider, type CompletionDefaults } from './completion-provider.js';

const LANGUAGE_ID = 'trinosql';

class TrinoSqlTokenizerState implements Monaco.languages.IState {
  clone(): Monaco.languages.IState {
    return new TrinoSqlTokenizerState();
  }

  equals(other: Monaco.languages.IState): boolean {
    return other instanceof TrinoSqlTokenizerState;
  }
}

/** Live getter for completion defaults. Updated by the MonacoEditor component
 *  whenever the user changes the default catalog/schema; the completion
 *  provider reads through this on every invocation. */
let defaultsGetter: () => CompletionDefaults = () => ({});

export function setCompletionDefaultsGetter(getter: () => CompletionDefaults): void {
  defaultsGetter = getter;
}

export interface RegisterOptions {
  /** Skip registering the completion provider. Tokens / syntax highlighting
   *  are unaffected — only the suggestion widget is gated. */
  completionEnabled?: boolean;
}

export function registerTrinoSql(monaco: typeof Monaco, options: RegisterOptions = {}): void {
  if (monaco.languages.getLanguages().some((lang) => lang.id === LANGUAGE_ID)) {
    return;
  }

  monaco.languages.register({ id: LANGUAGE_ID });

  if (options.completionEnabled !== false) {
    monaco.languages.registerCompletionItemProvider(
      LANGUAGE_ID,
      createCompletionProvider(monaco, () => defaultsGetter())
    );
  }

  monaco.languages.setTokensProvider(LANGUAGE_ID, {
    getInitialState: () => new TrinoSqlTokenizerState(),
    tokenize: (line: string, state: Monaco.languages.IState) => {
      const inputStream = CharStream.fromString(line);
      const lexer = new SqlBaseLexer(inputStream);
      lexer.reset();

      const tokens: Monaco.languages.IToken[] = [];
      let token = lexer.nextToken();
      while (token.type !== SqlBaseLexer.EOF) {
        tokens.push({
          startIndex: token.start,
          scopes: tokenMap[token.type] ?? 'identifier'
        });
        token = lexer.nextToken();
      }

      return { tokens, endState: state };
    }
  });
}

export { LANGUAGE_ID as TRINO_SQL_LANGUAGE_ID };
