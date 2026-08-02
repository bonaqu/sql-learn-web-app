import { canonicalModuleIds, moduleOrderIndex } from './learning-structure';

export type CanonicalModuleId = typeof canonicalModuleIds[number];

export type SqlSyntaxCapabilityId =
  | 'grouping'
  | 'having'
  | 'joins'
  | 'subquery'
  | 'exists'
  | 'cte'
  | 'window-functions'
  | 'date-time-functions'
  | 'text-normalization'
  | 'set-operations'
  | 'indexes'
  | 'explain'
  | 'transaction-control'
  | 'data-mutation'
  | 'schema-ddl'
  | 'schema-evolution'
  | 'null-safe-distinctness'
  | 'conditional-aggregate-filter'
  | 'recursive-cte'
  | 'window-frame'
  | 'json-sql'
  | 'upsert'
  | 'returning';

export type SqlSyntaxCapability = {
  id: SqlSyntaxCapabilityId;
  title: string;
  introducedBy: CanonicalModuleId;
  pattern: RegExp;
  rationale: string;
};

export const sqlSyntaxCapabilities: readonly SqlSyntaxCapability[] = [
  {
    id: 'grouping',
    title: 'GROUP BY',
    introducedBy: 'grouping',
    pattern: /\bgroup\s+by\b/i,
    rationale: 'Changing result grain must follow aggregate-set reasoning.'
  },
  {
    id: 'having',
    title: 'HAVING',
    introducedBy: 'grouping',
    pattern: /\bhaving\b/i,
    rationale: 'Filtering groups requires the WHERE-versus-HAVING mental model.'
  },
  {
    id: 'joins',
    title: 'JOIN',
    introducedBy: 'joins',
    pattern: /\b(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join\b/i,
    rationale: 'Relation cardinality and key ownership must be introduced before JOIN is required.'
  },
  {
    id: 'subquery',
    title: 'nested SELECT',
    introducedBy: 'subqueries',
    pattern: /\(\s*select\b/i,
    rationale: 'A nested result shape must follow explicit scalar/set/existence reasoning.'
  },
  {
    id: 'exists',
    title: 'EXISTS',
    introducedBy: 'subqueries',
    pattern: /\b(?:not\s+)?exists\s*\(/i,
    rationale: 'Existence predicates require the subquery contract first.'
  },
  {
    id: 'cte',
    title: 'CTE',
    introducedBy: 'cte',
    pattern: /(?:^|;)\s*with\b/im,
    rationale: 'Named query stages follow standalone subquery reasoning.'
  },
  {
    id: 'window-functions',
    title: 'window functions',
    introducedBy: 'windows',
    pattern: /\bover\s*\(/i,
    rationale: 'Window context must follow grouping and CTE composition.'
  },
  {
    id: 'date-time-functions',
    title: 'date/time functions',
    introducedBy: 'dates',
    pattern: /\b(?:date|datetime|strftime|julianday|unixepoch)\s*\(/i,
    rationale: 'Calendar grain and interval boundaries must be explicit before date transforms.'
  },
  {
    id: 'text-normalization',
    title: 'CASE and text normalization',
    introducedBy: 'text',
    pattern: /\bcase\b|\bcoalesce\s*\(|\b(?:lower|upper|trim|ltrim|rtrim|replace|substr|substring)\s*\(/i,
    rationale: 'Classification and missing-value semantics are introduced in the text module.'
  },
  {
    id: 'set-operations',
    title: 'set operations',
    introducedBy: 'set-ops',
    pattern: /\b(?:union(?:\s+all)?|intersect|except)\b/i,
    rationale: 'Vertical composition requires compatible result contracts.'
  },
  {
    id: 'indexes',
    title: 'CREATE INDEX',
    introducedBy: 'indexes',
    pattern: /\bcreate\s+(?:unique\s+)?index\b/i,
    rationale: 'Index DDL must follow data-quality and access-path reasoning.'
  },
  {
    id: 'explain',
    title: 'EXPLAIN',
    introducedBy: 'explain',
    pattern: /\bexplain(?:\s+query\s+plan)?\b/i,
    rationale: 'Execution-plan vocabulary must be introduced before plan evidence is required.'
  },
  {
    id: 'transaction-control',
    title: 'transaction control',
    introducedBy: 'transactions',
    pattern: /\b(?:begin(?:\s+transaction)?|commit|rollback|savepoint|release\s+savepoint)\b/i,
    rationale: 'Atomic change boundaries belong to the transactions module.'
  },
  {
    id: 'data-mutation',
    title: 'INSERT / UPDATE / DELETE',
    introducedBy: 'transactions',
    pattern: /\b(?:insert\s+into|update\s+[a-z_]|delete\s+from)\b/i,
    rationale: 'The first safe mutation is introduced inside an explicit transaction before the dedicated DML phase.'
  },
  {
    id: 'schema-ddl',
    title: 'schema DDL',
    introducedBy: 'schema',
    pattern: /\bcreate\s+table\b|\bforeign\s+key\b|\breferences\s+[a-z_]/i,
    rationale: 'Keys and integrity constraints require the schema-design mental model.'
  },
  {
    id: 'schema-evolution',
    title: 'ALTER TABLE',
    introducedBy: 'schema-evolution',
    pattern: /\balter\s+table\b/i,
    rationale: 'Compatibility-aware structural change belongs to schema evolution.'
  },
  {
    id: 'null-safe-distinctness',
    title: 'NULL-safe distinctness',
    introducedBy: 'null-logic-advanced',
    pattern: /\bis\s+(?:not\s+)?distinct\s+from\b/i,
    rationale: 'Three-valued equality must be explicit before NULL-safe comparison is required.'
  },
  {
    id: 'conditional-aggregate-filter',
    title: 'aggregate FILTER',
    introducedBy: 'conditional-aggregation',
    pattern: /\bfilter\s*\(\s*where\b/i,
    rationale: 'Multiple conditional measures require the conditional-aggregation model.'
  },
  {
    id: 'recursive-cte',
    title: 'recursive CTE',
    introducedBy: 'recursive-cte',
    pattern: /(?:^|;)\s*with\s+recursive\b/im,
    rationale: 'Anchor, recursive term and termination must be taught before recursion is required.'
  },
  {
    id: 'window-frame',
    title: 'window frame',
    introducedBy: 'window-frames',
    pattern: /\b(?:rows|range|groups)\s+between\b|\b(?:rows|range|groups)\s+(?:unbounded\s+preceding|current\s+row|\d+\s+(?:preceding|following))/i,
    rationale: 'Frame boundaries are a separate concept from basic window partitioning.'
  },
  {
    id: 'json-sql',
    title: 'JSON SQL',
    introducedBy: 'json-sql',
    pattern: /\bjson_(?:extract|each|tree|array|object|valid|type|set|insert|replace|remove)\s*\(|(?:->>|->)/i,
    rationale: 'JSON path, missing-key and type semantics must precede JSON extraction.'
  },
  {
    id: 'upsert',
    title: 'UPSERT',
    introducedBy: 'schema-evolution',
    pattern: /\bon\s+conflict\b|\bon\s+duplicate\s+key\b/i,
    rationale: 'Conflict-aware writes require mutation and constraint ownership first.'
  },
  {
    id: 'returning',
    title: 'DML RETURNING',
    introducedBy: 'dml',
    pattern: /\breturning\b/i,
    rationale: 'Observing changed rows belongs to the dedicated DML workflow.'
  }
] as const;

function replaceRange(source: string, start: number, end: number) {
  return source.slice(0, start) + ' '.repeat(end - start) + source.slice(end);
}

export function stripSqlCommentsAndLiterals(source: string) {
  let result = source;
  const ranges: Array<[number, number]> = [];
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === '-' && next === '-') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      ranges.push([start, index]);
      continue;
    }

    if (current === '/' && next === '*') {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(source.length, index + 2);
      ranges.push([start, index]);
      continue;
    }

    if (current === "'" || current === '"' || current === '`') {
      const quote = current;
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      ranges.push([start, index]);
      continue;
    }

    if (current === '[') {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== ']') index += 1;
      index = Math.min(source.length, index + 1);
      ranges.push([start, index]);
      continue;
    }

    index += 1;
  }

  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    result = replaceRange(result, start, end);
  }
  return result;
}

export function detectSqlSyntaxCapabilities(source: string) {
  const normalized = stripSqlCommentsAndLiterals(source);
  return sqlSyntaxCapabilities.filter(capability => capability.pattern.test(normalized));
}

export function syntaxCapabilityIsAvailable(capability: SqlSyntaxCapability, moduleId: string) {
  return moduleOrderIndex(moduleId) >= moduleOrderIndex(capability.introducedBy);
}

export function validateSyntaxCapabilityOwners() {
  const modules = new Set(canonicalModuleIds);
  return sqlSyntaxCapabilities.filter(capability => !modules.has(capability.introducedBy));
}
