// A statement file picked somewhere else (dropped on the Scan page) handed to the Money page's
// upload, which reads it straight away. In memory only.
let pending = null;
export const handOffStatement = (file) => { pending = file; };
export const takeStatement = () => { const f = pending; pending = null; return f; };

/** Spreadsheets and CSV files are statements, never bills. */
export const isStatementFile = (file) => /\.(xlsx|xls|ods|csv)$/i.test(file?.name || '')
  || /spreadsheet|ms-excel|text\/csv/.test(file?.type || '');
