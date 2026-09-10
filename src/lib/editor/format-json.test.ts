import { describe, it, expect } from 'vitest';
import { prettifyJson, repairTruncatedJson, stripIncompleteTail } from './format-json';

describe('prettifyJson', () => {
  it('returns empty string for empty input', () => {
    expect(prettifyJson('')).toBe('');
  });

  it('formats valid JSON object with indentation', () => {
    const result = prettifyJson('{"a":1,"b":2}');
    expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('formats valid JSON array with indentation', () => {
    const result = prettifyJson('[1,2,3]');
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('formats nested JSON with proper indentation', () => {
    const result = prettifyJson('{"a":{"b":[1,2]}}');
    expect(result).toBe('{\n  "a": {\n    "b": [\n      1,\n      2\n    ]\n  }\n}');
  });

  it('is idempotent—already formatted JSON returns unchanged', () => {
    const formatted = '{\n  "a": 1\n}';
    expect(prettifyJson(formatted)).toBe(formatted);
  });

  it('handles primitive JSON values', () => {
    expect(prettifyJson('true')).toBe('true');
    expect(prettifyJson('null')).toBe('null');
    expect(prettifyJson('42')).toBe('42');
    expect(prettifyJson('"hello"')).toBe('"hello"');
  });

  it('repairs truncated JSON with unclosed object', () => {
    const result = prettifyJson('{"a":1,');
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('repairs truncated JSON with unclosed nested object', () => {
    const result = prettifyJson('{"a":{"b":1');
    expect(result).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });

  it('repairs truncated JSON with unclosed string', () => {
    const result = prettifyJson('{"a":"hello');
    expect(result).toBe('{\n  "a": "hello"\n}');
  });

  it('returns raw text for completely invalid JSON', () => {
    const invalid = '{not valid json: }}}';
    expect(prettifyJson(invalid)).toBe(invalid);
  });

  it('strips incomplete trailing element and formats', () => {
    const result = prettifyJson('{"a":1,"b":');
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('strips incomplete trailing array element and formats', () => {
    const result = prettifyJson('[1,2,');
    expect(result).toBe('[\n  1,\n  2\n]');
  });
});

describe('repairTruncatedJson', () => {
  it('passes already-valid JSON through unchanged', () => {
    expect(repairTruncatedJson('{"a":1}')).toBe('{"a":1}');
  });

  it('passes already-valid JSON array through unchanged', () => {
    expect(repairTruncatedJson('[1,2,3]')).toBe('[1,2,3]');
  });

  it('closes an unclosed object', () => {
    expect(repairTruncatedJson('{"a":1')).toBe('{"a":1}');
  });

  it('closes an unclosed array', () => {
    expect(repairTruncatedJson('[1,2,3')).toBe('[1,2,3]');
  });

  it('closes nested unclosed structures', () => {
    expect(repairTruncatedJson('{"a":{"b":[1,2')).toBe('{"a":{"b":[1,2]}}');
  });

  it('closes an unclosed string', () => {
    expect(repairTruncatedJson('{"a":"hello')).toBe('{"a":"hello"}');
  });

  it('handles unclosed string after an escape character', () => {
    expect(repairTruncatedJson('{"a":"hello\\')).toBe('{"a":"hello"}');
  });

  it('removes trailing comma before closing brackets', () => {
    expect(repairTruncatedJson('{"a":1,')).toBe('{"a":1}');
  });

  it('handles empty input', () => {
    expect(repairTruncatedJson('')).toBe('');
  });

  it('handles unclosed object in empty object', () => {
    expect(repairTruncatedJson('{')).toBe('{}');
  });

  it('handles unclosed array in empty array', () => {
    expect(repairTruncatedJson('[')).toBe('[]');
  });

  it('does not close brackets inside strings', () => {
    expect(repairTruncatedJson('{"a":"{b}"')).toBe('{"a":"{b}"}');
  });

  it('ignores escaped quotes inside strings', () => {
    expect(repairTruncatedJson('{"a":"he\\"llo')).toBe('{"a":"he\\"llo"}');
  });
});

describe('stripIncompleteTail', () => {
  it('passes valid JSON through unchanged', () => {
    const valid = '{"a":1,"b":2}';
    expect(stripIncompleteTail(valid)).toBe(valid);
  });

  it('strips trailing comma with incomplete value', () => {
    const result = stripIncompleteTail('{"a":1,"b":');
    expect(result).toBe('{"a":1}');
  });

  it('strips incomplete array element', () => {
    const result = stripIncompleteTail('[1,2,');
    expect(result).toBe('[1,2]');
  });

  it('strips deeply nested incomplete value', () => {
    const result = stripIncompleteTail('{"a":{"b":[1,2,');
    // stripIncompleteTail removes the trailing comma+value, repairTruncatedJson closes the brackets
    expect(result).toBe('{"a":{"b":[1,2]}}');
  });

  it('returns input unchanged for an unbalanced opening bracket at the end', () => {
    const result = stripIncompleteTail('{"a":1,{');
    // The function cannot cleanly strip the incomplete `{` — this falls through to the raw-text fallback in prettifyJson
    expect(result).toBe('{"a":1,{');
  });

  it('returns input unchanged when no strip is possible', () => {
    const input = 'completely broken{';
    expect(stripIncompleteTail(input)).toBe(input);
  });

  it('recursively strips when re-closing does not produce valid JSON', () => {
    // stripIncompleteTail will strip the last comma part, then the recursive
    // call on the result may need to strip more
    const result = stripIncompleteTail('{"a":1,"b":2,');
    // First pass strips the trailing comma → {"a":1,"b":2}, re-closes → {"a":1,"b":2}
    expect(result).toBe('{"a":1,"b":2}');
  });

  it('strips incomplete value inside a string context correctly', () => {
    const result = stripIncompleteTail('{"a":"hello","b":');
    expect(result).toBe('{"a":"hello"}');
  });
});

describe('prettifyJson — complex incomplete JSON', () => {
  it('formats deeply nested truncated JSON: nested objects and arrays', () => {
    const result = prettifyJson('{"level1":{"level2":{"level3":[1,2,3],"level3b":{');
    expect(result).toBe(
      '{\n  "level1": {\n    "level2": {\n      "level3": [\n        1,\n        2,\n        3\n      ],\n      "level3b": {}\n    }\n  }\n}'
    );
  });

  it('repairs JSON truncated in the middle of a string value', () => {
    const result = prettifyJson('{"message":"hello world');
    expect(result).toBe('{\n  "message": "hello world"\n}');
  });

  it('repairs JSON with escaped quotes in truncated string', () => {
    const result = prettifyJson('{"text":"he said \\"hello');
    expect(result).toBe('{\n  "text": "he said \\"hello"\n}');
  });

  it('returns raw text when truncation leaves a key without a value', () => {
    // repairTruncatedJson closes the string → `{"c"}` which isn't valid JSON
    const result = prettifyJson('[{"a":1},{"b":2},{"c');
    expect(result).toBe('[{"a":1},{"b":2},{"c');
  });

  it('repairs truncated JSON with trailing comma at end of object', () => {
    const result = prettifyJson('{"a":1,"b":2,');
    expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('repairs truncated JSON with trailing comma at end of array', () => {
    const result = prettifyJson('[1,2,3,');
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('repairs single-element truncated array', () => {
    const result = prettifyJson('[1,');
    expect(result).toBe('[\n  1\n]');
  });

  it('returns an empty object for JSON truncated to just an opening brace', () => {
    // repairTruncatedJson closes the brace → `{}` which is valid JSON
    expect(prettifyJson('{')).toBe('{}');
  });

  it('returns raw text for JSON that is completely malformed', () => {
    expect(prettifyJson('{broken json!!!}')).toBe('{broken json!!!}');
  });

  it('returns raw text when nested truncation produces key without value', () => {
    const result = prettifyJson('{"items":[1,2,3,{"nested');
    expect(result).toBe('{"items":[1,2,3,{"nested');
  });

  it('handles JSON truncated at a comma after a closing bracket', () => {
    const result = prettifyJson('[{"a":1},');
    expect(result).toBe('[\n  {\n    "a": 1\n  }\n]');
  });

  it('formats valid JSON with all value types', () => {
    const result = prettifyJson(
      '{"str":"hello","num":42,"bool":true,"null":null,"arr":[1,2],"obj":{"k":"v"}}'
    );
    expect(result).toBe(
      '{\n  "str": "hello",\n  "num": 42,\n  "bool": true,\n  "null": null,\n  "arr": [\n    1,\n    2\n  ],\n  "obj": {\n    "k": "v"\n  }\n}'
    );
  });

  it('returns raw text when JSON is truncated mid-key', () => {
    // repairTruncatedJson closes the string → `{"onlykey"}` which isn't valid JSON
    const result = prettifyJson('{"onlykey');
    expect(result).toBe('{"onlykey');
  });
});
