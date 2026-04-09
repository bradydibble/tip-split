import { GoogleAuth } from 'google-auth-library';

async function getToken(credJson: string): Promise<string> {
  const credentials = JSON.parse(credJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google access token');
  return token;
}

async function getFirstRow(
  spreadsheetId: string,
  sheetName: string,
  token: string
): Promise<string[] | null> {
  const range = encodeURIComponent(`'${sheetName}'!1:1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.values?.[0] ?? null;
}

async function patchHeaderRow(
  spreadsheetId: string,
  sheetName: string,
  token: string
): Promise<void> {
  const range = encodeURIComponent(`'${sheetName}'!1:1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });
}

export const HEADER_ROW = [
  'Date', 'Shift', 'Type', 'Calc ID',
  'Gross Tips', 'CC Fee Rate', 'CC Fees', 'Net Tips',
  'Kitchen %', 'Kitchen Pool', 'Liquor Sales', 'Bar Liquor %', 'Bar Pool', 'FOH Pool',
  'Name', 'Role', 'FOH Share', 'Bar Share', 'Kitchen Share', 'Total',
  'Staff ID', 'Exported At', 'Export ID',
];

/**
 * Append rows to a Google Sheet.
 * Writes the header row first only when the sheet is empty.
 * Patches the header row if it exists but is missing new audit columns.
 */
export async function appendToSheet(
  spreadsheetId: string,
  sheetName: string,
  dataRows: (string | number)[][],
  credJson: string
): Promise<void> {
  const token = await getToken(credJson);
  const range = encodeURIComponent(`'${sheetName}'!A1`);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const firstRow = await getFirstRow(spreadsheetId, sheetName, token);

  let values: (string | number)[][];
  if (!firstRow || firstRow.length === 0) {
    // Sheet is empty — prepend the header
    values = [HEADER_ROW, ...dataRows];
  } else {
    // Sheet has content — check if the header is up to date
    const lastHeaderCol = HEADER_ROW[HEADER_ROW.length - 1];
    if (firstRow[firstRow.length - 1] !== lastHeaderCol) {
      // Header exists but is missing new columns — patch row 1 in place
      await patchHeaderRow(spreadsheetId, sheetName, token);
    }
    values = dataRows;
  }

  const url = `${base}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }
}
