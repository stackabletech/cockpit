// Registers the 'trinosql' language with Monaco Editor using an ANTLR-based tokenizer.
// Based on https://github.com/trinodb/trino-query-ui/blob/fa6a5157058441b0ad318a75c13241f5b9dfc1e0/precise/src/QueryEditorPane.tsx#L678-L701

import type * as Monaco from 'monaco-editor';
import { CharStream } from 'antlr4ng';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';
import { tokenMap } from './tokenMap';

const LANGUAGE_ID = 'trinosql';

class TrinoSqlTokenizerState implements Monaco.languages.IState {
  clone(): Monaco.languages.IState {
    return new TrinoSqlTokenizerState();
  }

  equals(other: Monaco.languages.IState): boolean {
    return other instanceof TrinoSqlTokenizerState;
  }
}

export function registerTrinoSql(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some((lang) => lang.id === LANGUAGE_ID)) {
    return;
  }

  monaco.languages.register({ id: LANGUAGE_ID });

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
