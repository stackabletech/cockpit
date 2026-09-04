export function repairTruncatedJson(text: string): string {
  let result = text;
  let inString = false;
  let escape = false;
  const openBrackets: string[] = [];

  for (let i = 0; i < result.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const ch = result[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      openBrackets.push(ch);
    } else if (ch === '}') {
      if (openBrackets.at(-1) === '{') openBrackets.pop();
    } else if (ch === ']') {
      if (openBrackets.at(-1) === '[') openBrackets.pop();
    }
  }

  if (inString) {
    if (escape) result = result.slice(0, -1);
    result += '"';
  }

  result = result.trimEnd();
  if (result.endsWith(',')) {
    result = result.slice(0, -1).trimEnd();
  }

  for (let i = openBrackets.length - 1; i >= 0; i--) {
    // eslint-disable-next-line security/detect-object-injection
    result += openBrackets[i] === '{' ? '}' : ']';
  }

  return result;
}

export function stripIncompleteTail(json: string): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastComma = -1;

  for (let i = json.length - 1; i >= 0; i--) {
    // eslint-disable-next-line security/detect-object-injection
    const ch = json[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === '}' || ch === ']') {
      depth++;
    } else if (ch === '{' || ch === '[') {
      depth--;
      if (depth < 0) return json.substring(0, i + 1);
    } else if (ch === ',' && depth === 0) {
      lastComma = i;
      break;
    }
  }

  if (lastComma >= 0) {
    const before = json.substring(0, lastComma).trimEnd();
    const reClosed = repairTruncatedJson(before);
    try {
      JSON.parse(reClosed);
      return reClosed;
    } catch {
      const simpler = stripIncompleteTail(before);
      if (simpler !== before) return simpler;
    }
  }

  return json;
}

export function prettifyJson(text: string): string {
  if (!text) return text;

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // not valid — try to repair truncated JSON
  }

  const basic = repairTruncatedJson(text);
  try {
    return JSON.stringify(JSON.parse(basic), null, 2);
  } catch {
    // still invalid — strip trailing incomplete elements and retry
  }

  const stripped = stripIncompleteTail(text);
  if (stripped !== text) {
    try {
      return JSON.stringify(JSON.parse(stripped), null, 2);
    } catch {
      // give up
    }
  }

  return text;
}
