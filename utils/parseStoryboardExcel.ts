import {
  STORYBOARD_EXCEL_FORMAT_ERR,
  findStoryboardExcelHeaderRowIndex,
  getMissingStoryboardExcelRequiredHeaders,
  normalizeStoryboardHeaderCell,
} from './storyboardTableSpawn';

export type ParseStoryboardExcelResult =
  | { ok: true; rows: string[][]; sheetName: string; headerRowIndex: number }
  | { ok: false; error: string };

function normalizeMatrixRows(raw: unknown[][]): string[][] {
  return raw.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => normalizeStoryboardHeaderCell(cell))
  );
}

/** 去掉表头以下全空行，保留表头 */
export function trimStoryboardMatrixRows(matrix: string[][]): string[][] {
  if (!matrix.length) return matrix;
  const [head, ...body] = matrix;
  const trimmedBody = body.filter((row) => row.some((c) => c));
  return [head, ...trimmedBody];
}

export function validateStoryboardExcelHeaderRow(headers: string[]): string | null {
  const missing = getMissingStoryboardExcelRequiredHeaders(headers);
  if (missing.length === 0) return null;
  return `${STORYBOARD_EXCEL_FORMAT_ERR}\n缺少：${missing.join('、')}`;
}

/** 解析 .xlsx / .xls 为 string[][]（自动定位表头行，严格校验列名） */
export async function parseStoryboardExcelFile(file: File): Promise<ParseStoryboardExcelResult> {
  const name = (file.name || '').toLowerCase();
  if (!/\.(xlsx|xls)$/i.test(name)) {
    return { ok: false, error: '请选择 Excel 文件（.xlsx 或 .xls）' };
  }

  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    return { ok: false, error: '无法加载 Excel 解析模块，请刷新页面后重试' };
  }

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return { ok: false, error: 'Excel 文件中没有工作表' };
    }
    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown[][];
    const matrix = normalizeMatrixRows(raw).filter((row) => row.some((c) => c));
    if (matrix.length < 2) {
      return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
    }

    const headerRowIndex = findStoryboardExcelHeaderRowIndex(matrix);
    if (headerRowIndex < 0) {
      return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
    }

    const tableRows = trimStoryboardMatrixRows(matrix.slice(headerRowIndex));
    if (tableRows.length < 2) {
      return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
    }

    const headerErr = validateStoryboardExcelHeaderRow(tableRows[0]);
    if (headerErr) {
      return { ok: false, error: headerErr };
    }

    return { ok: true, rows: tableRows, sheetName, headerRowIndex };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Excel 解析失败：${msg}` };
  }
}
