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
  if (!res.ok) return true; // treat unreadable as empty; append will surface real errors
  const body = await res.json();
  return !body.values || body.values.length === 0;
}

/**
 * Append a data row to a Google Sheet.
 * Writes the header row first only when the sheet is empty.
 */
export async function appendToSheet(
  spreadsheetId: string,
  sheetName: string,
  headerRow: (string | number)[],
  dataRow: (string | number)[],
  credJson: string
): Promise<void> {
  const token = await getToken(credJson);
  const range = encodeURIComponent(`'${sheetName}'!A1`);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const empty = await sheetIsEmpty(spreadsheetId, range, token);
  const values = empty ? [headerRow, dataRow] : [dataRow];

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
