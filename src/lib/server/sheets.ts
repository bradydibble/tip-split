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

/**
 * Append rows to a Google Sheet.
 * Values are plain strings/numbers; Sheets will auto-detect dates and numbers.
 */
export async function appendToSheet(
  spreadsheetId: string,
  sheetName: string,
  values: (string | number)[][],
  credJson: string
): Promise<void> {
  const token = await getToken(credJson);
  const range = encodeURIComponent(sheetName);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

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
