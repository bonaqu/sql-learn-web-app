import initSqlJs, { type SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let runtimePromise: Promise<SqlJsStatic> | null = null;

export function loadCapstoneSqlRuntime() {
  runtimePromise ||= initSqlJs({ locateFile: () => sqlWasmUrl });
  return runtimePromise;
}
