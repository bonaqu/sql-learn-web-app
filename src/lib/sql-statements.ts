/** Split executable SQL without treating quoted strings or comments as statement boundaries. */
export function splitSqlStatements(source: string) {
  const result: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === '-' && next === '-') { lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if (character === '[') { quote = ']'; continue; }
    if (character === ';') {
      const statement = source.slice(start, index).trim();
      if (statement.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()) result.push(statement);
      start = index + 1;
    }
  }
  const final = source.slice(start).trim();
  if (final.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()) result.push(final);
  return result;
}

/** Only inspect SQL structure; quoted values remain opaque. */
export function sqlStructure(source: string) {
  return source.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    match => match.startsWith('--') || match.startsWith('/*') ? ' ' : "''");
}

export function initialLabSetup(source: string) {
  const statements = splitSqlStatements(source);
  let count = 0;
  for (const statement of statements) {
    const structure = sqlStructure(statement).trim();
    const create = /^CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\b/i.test(structure) && !/\bAS\s+(?:SELECT|WITH)\b/i.test(structure);
    const insert = /^INSERT\s+INTO\b/i.test(structure) && /\bVALUES\b/i.test(structure) && !/\bON\s+CONFLICT\b/i.test(structure);
    if (!create && !insert) break;
    count += 1;
  }
  return { setupSql: statements.slice(0, count).join('; '), bodySql: statements.slice(count).join('; '), count };
}
