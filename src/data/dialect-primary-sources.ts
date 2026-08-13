import type { DialectCapability, SqlDialect } from './dialect-lab-manifests';

export type DialectPrimarySource = {
  capability: DialectCapability;
  dialect: SqlDialect;
  title: string;
  url: string;
  reviewedAt: '2026-08-13';
};

const source = (
  capability: DialectCapability,
  dialect: SqlDialect,
  title: string,
  url: string
): DialectPrimarySource => ({ capability, dialect, title, url, reviewedAt: '2026-08-13' });

export const dialectPrimarySources: readonly DialectPrimarySource[] = [
  source('null-ordering', 'sqlite', 'SQLite SELECT — ORDER BY', 'https://www.sqlite.org/lang_select.html#orderby'),
  source('null-ordering', 'postgresql', 'PostgreSQL 18 — Sorting Rows', 'https://www.postgresql.org/docs/current/queries-order.html'),
  source('null-ordering', 'mysql', 'MySQL 8.4 — Working with NULL Values', 'https://dev.mysql.com/doc/refman/8.4/en/working-with-null.html'),
  source('date-time', 'sqlite', 'SQLite Date And Time Functions', 'https://www.sqlite.org/lang_datefunc.html'),
  source('date-time', 'postgresql', 'PostgreSQL 18 — Date/Time Functions and Operators', 'https://www.postgresql.org/docs/current/functions-datetime.html'),
  source('date-time', 'mysql', 'MySQL 8.4 — Date and Time Functions', 'https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html'),
  source('json', 'sqlite', 'SQLite JSON Functions And Operators', 'https://www.sqlite.org/json1.html'),
  source('json', 'postgresql', 'PostgreSQL 18 — JSON Functions and Operators', 'https://www.postgresql.org/docs/current/functions-json.html'),
  source('json', 'mysql', 'MySQL 8.4 — Functions That Search JSON Values', 'https://dev.mysql.com/doc/refman/8.4/en/json-search-functions.html'),
  source('upsert', 'sqlite', 'SQLite UPSERT', 'https://www.sqlite.org/lang_upsert.html'),
  source('upsert', 'postgresql', 'PostgreSQL 18 — INSERT / ON CONFLICT', 'https://www.postgresql.org/docs/current/sql-insert.html'),
  source('upsert', 'mysql', 'MySQL 8.4 — INSERT ... ON DUPLICATE KEY UPDATE', 'https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html'),
  source('generated-columns', 'sqlite', 'SQLite Generated Columns', 'https://www.sqlite.org/gencol.html'),
  source('generated-columns', 'postgresql', 'PostgreSQL 18 — Generated Columns', 'https://www.postgresql.org/docs/current/ddl-generated-columns.html'),
  source('generated-columns', 'mysql', 'MySQL 8.4 — CREATE TABLE Generated Column Syntax', 'https://dev.mysql.com/doc/refman/8.4/en/create-table-generated-columns.html'),
  source('recursive-cte', 'sqlite', 'SQLite WITH — Recursive Common Table Expressions', 'https://www.sqlite.org/lang_with.html#recursive_common_table_expressions'),
  source('recursive-cte', 'postgresql', 'PostgreSQL 18 — WITH Queries', 'https://www.postgresql.org/docs/current/queries-with.html'),
  source('recursive-cte', 'mysql', 'MySQL 8.4 — Recursive Common Table Expressions', 'https://dev.mysql.com/doc/refman/8.4/en/with.html'),
  source('window-frame', 'sqlite', 'SQLite Window Functions', 'https://www.sqlite.org/windowfunctions.html'),
  source('window-frame', 'postgresql', 'PostgreSQL 18 — Window Functions', 'https://www.postgresql.org/docs/current/functions-window.html'),
  source('window-frame', 'mysql', 'MySQL 8.4 — Window Function Frame Specification', 'https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html'),
  source('pagination', 'sqlite', 'SQLite Row Values', 'https://www.sqlite.org/rowvalue.html'),
  source('pagination', 'postgresql', 'PostgreSQL 18 — Row Constructor Comparison', 'https://www.postgresql.org/docs/current/functions-comparisons.html#ROW-WISE-COMPARISON'),
  source('pagination', 'mysql', 'MySQL 8.4 — Row Constructor Expression Optimization', 'https://dev.mysql.com/doc/refman/8.4/en/row-constructor-optimization.html'),
  source('query-plan', 'sqlite', 'SQLite EXPLAIN QUERY PLAN', 'https://www.sqlite.org/eqp.html'),
  source('query-plan', 'postgresql', 'PostgreSQL 18 — Using EXPLAIN', 'https://www.postgresql.org/docs/current/using-explain.html'),
  source('query-plan', 'mysql', 'MySQL 8.4 — EXPLAIN Statement', 'https://dev.mysql.com/doc/refman/8.4/en/explain.html'),
  source('transaction-isolation', 'sqlite', 'SQLite Isolation In SQLite', 'https://www.sqlite.org/isolation.html'),
  source('transaction-isolation', 'postgresql', 'PostgreSQL 18 — Transaction Isolation', 'https://www.postgresql.org/docs/current/transaction-iso.html'),
  source('transaction-isolation', 'mysql', 'MySQL 8.4 — InnoDB Transaction Isolation Levels', 'https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html'),
  source('locking', 'sqlite', 'SQLite Isolation And Serialized Writes', 'https://www.sqlite.org/isolation.html'),
  source('locking', 'postgresql', 'PostgreSQL 18 — SELECT Locking Clause', 'https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE'),
  source('locking', 'mysql', 'MySQL 8.4 — InnoDB Locking Reads', 'https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html')
];

export function primarySourcesForCapability(capability: DialectCapability) {
  return dialectPrimarySources.filter(item => item.capability === capability);
}
