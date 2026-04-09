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

async function sheetIsEmpty(
  spreadsheetId: string,
  range: string,
  token: string
): Promise<boolean> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return true;
  const body = await res.json();
  return !body.values || body.values.length === 0;
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

  const empty = await sheetIsEmpty(spreadsheetId, range, token);
  const values = empty ? [HEADER_ROW, ...dataRows] : dataRows;

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
