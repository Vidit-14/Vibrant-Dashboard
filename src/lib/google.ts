import "server-only";
import { google, type sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;

let client: sheets_v4.Sheets | null = null;

function sheets(): sheets_v4.Sheets {
  if (!client) {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    client = google.sheets({ version: "v4", auth });
  }
  return client;
}

/** Raw cell values of an entire worksheet (formatted strings, like gspread get_all_values). */
export async function getSheetValues(sheetName: string): Promise<string[][]> {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'`,
  });
  return (res.data.values ?? []) as string[][];
}

export async function appendRows(sheetName: string, rows: unknown[][]) {
  await sheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows as string[][] },
  });
}

/** Clear the sheet and write header + rows (like set_with_dataframe with resize). */
export async function overwriteSheet(sheetName: string, header: string[], rows: unknown[][]) {
  const api = sheets();
  await api.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'`,
  });
  await api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [header, ...(rows as string[][])] },
  });
}

/** Create the worksheet with headers if it doesn't exist yet. */
export async function ensureSheet(sheetName: string, headers: string[]) {
  const api = sheets();
  const meta = await api.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === sheetName);
  if (!exists) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}
