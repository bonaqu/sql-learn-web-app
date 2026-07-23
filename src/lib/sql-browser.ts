import initSqlJsRuntime from 'sql.js/dist/sql-wasm.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const initSqlJs: typeof import('sql.js').default = config => initSqlJsRuntime({
  ...config,
  locateFile: file => file.endsWith('.wasm') ? wasmUrl : config?.locateFile?.(file) || file
});

export default initSqlJs;
