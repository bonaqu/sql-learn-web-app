import initSqlJsRuntime from 'sql.js/dist/sql-wasm.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let runtimePromise: ReturnType<typeof initSqlJsRuntime> | null = null;

const initSqlJs = (config?: Parameters<typeof initSqlJsRuntime>[0]) => {
  runtimePromise ||= initSqlJsRuntime({
    ...config,
    locateFile: (file, prefix) => file.endsWith('.wasm')
      ? wasmUrl
      : config?.locateFile?.(file, prefix) || `${prefix}${file}`
  });
  return runtimePromise;
};

export default initSqlJs;
