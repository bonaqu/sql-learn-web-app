import type { DialectLabCase } from '../data/dialect-lab-cases';
import type { DialectStatementPolicy } from '../data/dialect-lab-manifests';

export type DialectPolicyVerdict = {
  ok: boolean;
  statements: string[];
  normalizedSql: string;
  errors: string[];
};

const MAX_SQL_BYTES = 24_000;
const GLOBAL_DENY = [
  'PG_SLEEP',
  'PG_SLEEP_FOR',
  'PG_SLEEP_UNTIL',
  'LOAD_FILE',
  'INTO DUMPFILE',
  'LO_IMPORT',
  'LO_EXPORT',
  'PG_READ_FILE',
  'PG_READ_BINARY_FILE',
  'PG_LS_DIR',
  'DBLINK',
  'CREATE EXTENSION',
  'CREATE FUNCTION',
  'CREATE PROCEDURE',
  'CREATE TRIGGER',
  'CREATE EVENT',
  'SET ROLE',
  'SET SESSION AUTHORIZATION'
] as const;
const DML_ACTIONS = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE'] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(value: string) {
  return new RegExp(`(^|[^A-Z0-9_])${escapeRegExp(value.toUpperCase()).replace(/\\ /g, '\\s+')}([^A-Z0-9_]|$)`, 'i');
}

function semanticMarker(value: string) {
  return value
    .toUpperCase()
    .replace(/'(?:''|[^'])*'/g, ' ')
    .replace(/"(?:""|[^"])*"/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([+\-])\s*/g, '$1')
    .trim();
}

function includesSemanticMarker(normalizedSql: string, value: string) {
  const marker = semanticMarker(value);
  return Boolean(marker) && semanticMarker(normalizedSql).includes(marker);
}

function scrubSql(source: string) {
  let output = '';
  let statement = '';
  const statements: string[] = [];
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;
  let blockDepth = 0;

  const flush = () => {
    const value = statement.trim();
    if (value) statements.push(value);
    statement = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1] || '';

    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += '\n';
        statement += '\n';
      } else {
        output += ' ';
        statement += ' ';
      }
      continue;
    }

    if (blockComment) {
      if (current === '/' && next === '*') {
        blockDepth += 1;
        output += '  ';
        statement += '  ';
        index += 1;
        continue;
      }
      if (current === '*' && next === '/') {
        blockDepth -= 1;
        output += '  ';
        statement += '  ';
        index += 1;
        if (blockDepth <= 0) blockComment = false;
        continue;
      }
      output += current === '\n' ? '\n' : ' ';
      statement += current === '\n' ? '\n' : ' ';
      continue;
    }

    if (quote) {
      const closing = quote === ']' ? ']' : quote;
      if (current === closing) {
        if (quote !== ']' && next === closing) {
          output += '  ';
          statement += '  ';
          index += 1;
          continue;
        }
        quote = null;
      }
      output += current === '\n' ? '\n' : ' ';
      statement += current === '\n' ? '\n' : ' ';
      continue;
    }

    if (current === '-' && next === '-') {
      lineComment = true;
      output += '  ';
      statement += '  ';
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      blockDepth = 1;
      output += '  ';
      statement += '  ';
      index += 1;
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output += ' ';
      statement += ' ';
      continue;
    }
    if (current === '[') {
      quote = ']';
      output += ' ';
      statement += ' ';
      continue;
    }
    if (current === ';') {
      output += ';';
      flush();
      continue;
    }

    output += current;
    statement += current;
  }

  flush();
  return {
    scrubbed: output.replace(/\s+/g, ' ').trim().toUpperCase(),
    statements: statements.map(item => item.replace(/\s+/g, ' ').trim()),
    unterminated: Boolean(quote || blockComment)
  };
}

function statementPrefix(statement: string) {
  return statement.replace(/^\s+/, '').toUpperCase();
}

function actionAllowed(action: string, policy: DialectStatementPolicy) {
  return policy.allow.some(item => {
    const allowed = item.toUpperCase();
    return allowed === action || allowed.startsWith(`${action} `) || action.startsWith(`${allowed} `);
  });
}

function dmlSurface(statement: string) {
  return statement
    .toUpperCase()
    .replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/g, 'ON DUPLICATE KEY ACTION')
    .replace(/DO\s+UPDATE/g, 'CONFLICT ACTION');
}

export function validateDialectSqlPolicy(sql: string, policy: DialectStatementPolicy): DialectPolicyVerdict {
  const errors: string[] = [];
  const bytes = new TextEncoder().encode(sql).byteLength;
  if (!sql.trim()) errors.push('SQL пустой.');
  if (bytes > MAX_SQL_BYTES) errors.push(`SQL превышает лимит ${MAX_SQL_BYTES} байт.`);
  if (sql.includes('\0')) errors.push('Нулевой байт запрещён.');

  const scanned = scrubSql(sql);
  if (scanned.unterminated) errors.push('Незавершённая строка или комментарий.');
  if (scanned.statements.length > policy.maximumStatements) {
    errors.push(`Разрешено не более ${policy.maximumStatements} statements.`);
  }

  for (const denied of [...policy.deny, ...GLOBAL_DENY]) {
    if (phrasePattern(denied).test(scanned.scrubbed)) errors.push(`Запрещённая конструкция: ${denied}.`);
  }

  for (const statement of scanned.statements) {
    const prefix = statementPrefix(statement);
    const allowed = policy.allow.some(item => prefix === item || prefix.startsWith(`${item} `) || prefix.startsWith(`${item}\n`));
    if (!allowed) errors.push(`Statement не входит в allowlist: ${prefix.slice(0, 80)}.`);

    const surface = dmlSurface(statement);
    for (const action of DML_ACTIONS) {
      if (phrasePattern(action).test(surface) && !actionAllowed(action, policy)) {
        errors.push(`DML ${action} скрыт внутри разрешённого statement.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    statements: scanned.statements,
    normalizedSql: scanned.scrubbed,
    errors: Array.from(new Set(errors))
  };
}

export function evaluateDialectCaseSql(sql: string, labCase: DialectLabCase, policy: DialectStatementPolicy) {
  const policyVerdict = validateDialectSqlPolicy(sql, policy);
  const normalized = policyVerdict.normalizedSql;
  const missing = labCase.requiredPatterns.filter(pattern => !includesSemanticMarker(normalized, pattern));
  const forbidden = labCase.forbiddenPatterns.filter(pattern => includesSemanticMarker(normalized, pattern));
  const errors = [
    ...policyVerdict.errors,
    ...missing.map(pattern => `Не подтверждён semantic marker: ${pattern}.`),
    ...forbidden.map(pattern => `Anti-pattern нарушает portability contract: ${pattern}.`)
  ];
  return {
    ok: errors.length === 0,
    errors: Array.from(new Set(errors)),
    normalizedSql: normalized,
    statements: policyVerdict.statements,
    matchedPatterns: labCase.requiredPatterns.filter(pattern => includesSemanticMarker(normalized, pattern))
  };
}
