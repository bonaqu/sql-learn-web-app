import initSqlJsRuntime from 'sql.js/dist/sql-wasm.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const initSqlJs = (config?: Parameters<typeof initSqlJsRuntime>[0]) => initSqlJsRuntime({
  ...config,
  locateFile: (file, prefix) => file.endsWith('.wasm')
    ? wasmUrl
    : config?.locateFile?.(file, prefix) || `${prefix}${file}`
});

export default initSqlJs;
