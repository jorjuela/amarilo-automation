import { google } from 'googleapis'
import type { Project, InventoryRow, StatusRow, TorreData } from '@/types'

function createSheetsClient(credentials: { clientEmail: string; privateKey: string }) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.clientEmail,
      private_key: credentials.privateKey.replace(/\\n/g, '\n'),
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  }
}

export async function createAmiloClientSheet(
  credentials: { clientEmail: string; privateKey: string },
  folderId: string,
  project: Project & { torres: TorreData[] }
): Promise<{ spreadsheetId: string; url: string }> {
  const { sheets, drive } = createSheetsClient(credentials)

  const sheetName = `Amarilo-cliente`

  // Create spreadsheet
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: sheetName },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: 'inventario-piezas',
            gridProperties: { frozenRowCount: 2 },
          },
        },
        {
          properties: {
            sheetId: 1,
            title: 'estatus-creatividad',
            gridProperties: { frozenRowCount: 1 },
          },
        },
      ],
    },
  })

  const spreadsheetId = createRes.data.spreadsheetId!

  // Move to folder
  if (folderId) {
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: folderId,
      requestBody: {},
    })
  }

  // Populate inventario-piezas
  await populateInventorySheet(sheets, spreadsheetId, project)

  // Populate estatus-creatividad
  await populateStatusSheet(sheets, spreadsheetId, project)

  // Apply formatting
  await applyInventoryFormatting(sheets, spreadsheetId)
  await applyStatusFormatting(sheets, spreadsheetId)

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  }
}

async function populateInventorySheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  project: Project & { torres: TorreData[] }
) {
  // Header row 1 (merged groups)
  const header1 = [
    'ESPECIALISTA', 'CIUDAD', 'SALA', 'PROYECTO', 'TIPO', 'ETAPA',
    'ACTIVOS EN PAUTA', '', // merged
    'CREATIVIDAD META', '', '',  // merged
    'CREATIVIDAD PMAX', '', '', '', '',  // merged
    'NUEVO CM', '', '', '',  // merged
  ]

  // Header row 2 (sub-headers)
  const header2 = [
    '', '', '', '', '', '',
    'Meta', 'PMAX',
    'Estático', 'Carrusel', 'Video',
    'Estático', 'Video', 'Textos Cortos', 'Textos Largos', 'Descripciones',
    'Estático Original', 'Estático Adaptación', 'Video Original', 'Video Adaptación',
  ]

  const rows: (string | number)[][] = [header1, header2]

  // Add one row per torre per project
  for (const torre of project.torres) {
    rows.push([
      '',                        // ESPECIALISTA (to fill)
      project.city,
      project.name,
      torre.name,
      project.type,
      project.stage,
      'SI',                     // Activo Meta
      'SI',                     // Activo PMAX
      4,                        // Meta Estático
      0,                        // Meta Carrusel
      2,                        // Meta Video
      20,                       // PMAX Estático
      3,                        // PMAX Video
      11,                       // Textos Cortos
      2,                        // Textos Largos
      5,                        // Descripciones
      5,                        // CM Estático Original
      19,                       // CM Estático Adaptación
      1,                        // CM Video Original
      2,                        // CM Video Adaptación
    ])
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'inventario-piezas!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  })
}

async function populateStatusSheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  project: Project & { torres: TorreData[] }
) {
  const header = [
    'ESPECIALISTA', 'CIUDAD', 'SALA', 'PROYECTO', 'TIPO', 'ENTREGABLE',
    'PRIORIDAD', 'ESTATUS', 'RECEPCIÓN',
    'CREATIVIDAD INICIO', 'CREATIVIDAD ENTREGA',
    'PRODUCCIÓN INICIO', 'PRODUCCIÓN ENTREGA',
    'COMENTARIOS',
  ]

  const rows: (string | number)[][] = [header]

  const entregables = ['Desarrollo material META', 'Desarrollo material PMAX', 'Desarrollo material Programmatic']

  for (const torre of project.torres) {
    for (const entregable of entregables) {
      rows.push([
        '',            // ESPECIALISTA
        project.city,
        project.name,
        torre.name,
        project.type,
        entregable,
        '-',           // PRIORIDAD
        'Pendiente',   // ESTATUS
        new Date().toLocaleDateString('es-CO'),
        '',            // CREATIVIDAD INICIO
        '',            // CREATIVIDAD ENTREGA
        'NA',
        'NA',
        '',            // COMENTARIOS
      ])
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'estatus-creatividad!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  })
}

async function applyInventoryFormatting(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Header background - dark blue
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.18, green: 0.24, blue: 0.42 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // Sub-header background - amarilo yellow
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.98, green: 0.78, blue: 0.02 },
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // Auto resize columns
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 20 },
          },
        },
      ],
    },
  })
}

async function applyStatusFormatting(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.98, green: 0.78, blue: 0.02 },
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 1, dimension: 'COLUMNS', startIndex: 0, endIndex: 14 },
          },
        },
      ],
    },
  })
}

export async function appendToExistingSheet(
  credentials: { clientEmail: string; privateKey: string },
  spreadsheetId: string,
  project: Project & { torres: TorreData[] }
) {
  const { sheets } = createSheetsClient(credentials)

  // Append to inventario-piezas
  const inventoryRows = project.torres.map((torre) => [
    '',
    project.city,
    project.name,
    torre.name,
    project.type,
    project.stage,
    'SI', 'SI',
    4, 0, 2, 20, 3, 11, 2, 5, 5, 19, 1, 2,
  ])

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'inventario-piezas!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: inventoryRows },
  })

  // Append to estatus-creatividad
  const statusRows = project.torres.flatMap((torre) =>
    ['Meta', 'PMAX', 'Programmatic'].map((entregable) => [
      '',
      project.city,
      project.name,
      torre.name,
      project.type,
      `Desarrollo material ${entregable}`,
      '-', 'Pendiente',
      new Date().toLocaleDateString('es-CO'),
      '', '', 'NA', 'NA', '',
    ])
  )

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'estatus-creatividad!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: statusRows },
  })
}
