// Kept separate from trinosql.ts so it can be imported without pulling in the
// ANTLR lexer/parser, which are only loaded client-side together with Monaco.
export const TRINO_SQL_LANGUAGE_ID = 'trinosql';
