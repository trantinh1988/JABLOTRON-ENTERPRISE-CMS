import { vi } from '../i18n/vi'
import type { HistoryRow } from './historyRows'

const ENC = new TextEncoder()

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function colLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of data) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** Uncompressed ZIP — Excel accepts STORE xlsx. */
function zipStore(files: { name: string; data: Uint8Array }[]): Blob {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = ENC.encode(file.name)
    const crc = crc32(file.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ])
    locals.push(local)
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    offset += local.length
  }
  const central = concat(centrals)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  const packed = concat([...locals, central, end])
  const copy = new Uint8Array(packed.byteLength)
  copy.set(packed)
  return new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function fetchImageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2_000)
}

function reportStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

const HEADERS = [
  vi.historyColTime,
  vi.historyColPanel,
  vi.historyColId,
  vi.historyColLabel,
  vi.historyColSection,
  vi.historyColStatus,
  vi.historyColPhoto,
]

function rowCells(row: HistoryRow, photoText: string): string[] {
  return [row.tsLabel, row.panelName, row.idLabel, row.label, row.section, row.status, photoText]
}

function sheetXml(
  rows: HistoryRow[],
  photos: string[],
  hasDrawings: boolean,
): string {
  const widths = [22, 22, 10, 22, 18, 20, 16]
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')
  const header = HEADERS.map((h, i) => {
    const ref = `${colLetter(i)}1`
    return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(h)}</t></is></c>`
  }).join('')
  const body = rows
    .map((row, ri) => {
      const r = ri + 2
      const height = hasDrawings && row.snap ? ' ht="52" customHeight="1"' : ''
      const cells = rowCells(row, photos[ri] || '—')
        .map((val, i) => {
          const ref = `${colLetter(i)}${r}`
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>`
        })
        .join('')
      return `<row r="${r}"${height}>${cells}</row>`
    })
    .join('')
  const drawing = hasDrawings ? '<drawing r:id="rId1"/>' : ''
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<cols>${cols}</cols><sheetData>` +
    `<row r="1">${header}</row>${body}</sheetData>${drawing}</worksheet>`
  )
}

function drawingXml(anchors: { row: number; embed: string; id: number }[]): string {
  const pics = anchors
    .map((a) => {
      const fromRow = a.row
      const toRow = a.row + 1
      return (
        `<xdr:twoCellAnchor editAs="oneCell">` +
        `<xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${a.id}" name="Picture ${a.id}"/>` +
        `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${a.embed}"/>` +
        `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
        `<xdr:clientData/></xdr:twoCellAnchor>`
      )
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${pics}</xdr:wsDr>`
  )
}

export async function exportHistoryExcel(rows: HistoryRow[], includeImages: boolean): Promise<void> {
  const photos: string[] = []
  const images: { row: number; bytes: Uint8Array; ext: 'jpeg' | 'png' }[] = []
  for (let i = 0; i < rows.length; i++) {
    const snap = rows[i].snap
    if (!snap) {
      photos.push('—')
      continue
    }
    if (!includeImages) {
      photos.push(vi.historyHasPhoto)
      continue
    }
    const bytes = await fetchImageBytes(snap.imageUrl)
    if (bytes) {
      const ext = snap.imageUrl.toLowerCase().includes('.png') ? 'png' : 'jpeg'
      images.push({ row: i + 1, bytes, ext })
      photos.push('')
    } else {
      photos.push(vi.historyHasPhoto)
    }
  }

  const hasDrawings = images.length > 0
  const files: { name: string; data: Uint8Array }[] = [
    {
      name: '[Content_Types].xml',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
          `<Default Extension="png" ContentType="image/png"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          (hasDrawings
            ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
            : '') +
          `</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
          ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Lich su su kien" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: 'xl/styles.xml',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
          `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
          `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
          `<fill><patternFill patternType="solid"><fgColor rgb="FF1A2734"/><bgColor indexed="64"/></patternFill></fill></fills>` +
          `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
          `<cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/>` +
          `<xf fontId="1" fillId="0" borderId="0" applyFont="1"/></cellXfs>` +
          `</styleSheet>`,
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: ENC.encode(sheetXml(rows, photos, hasDrawings)) },
  ]

  if (hasDrawings) {
    const rels = images
      .map(
        (img, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${img.ext}"/>`,
      )
      .join('')
    files.push({
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>` +
          `</Relationships>`,
      ),
    })
    files.push({
      name: 'xl/drawings/_rels/drawing1.xml.rels',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
      ),
    })
    files.push({
      name: 'xl/drawings/drawing1.xml',
      data: ENC.encode(
        drawingXml(images.map((img, i) => ({ row: img.row, embed: `rId${i + 1}`, id: i + 1 }))),
      ),
    })
    images.forEach((img, i) => {
      files.push({ name: `xl/media/image${i + 1}.${img.ext}`, data: img.bytes })
    })
  }

  downloadBlob(zipStore(files), `lich-su-su-kien_${reportStamp()}.xlsx`)
}

export async function exportHistoryPdf(rows: HistoryRow[], includeImages: boolean): Promise<void> {
  const photos: (string | null)[] = []
  for (const row of rows) {
    if (!includeImages || !row.snap) {
      photos.push(null)
      continue
    }
    photos.push(await fetchImageDataUri(row.snap.imageUrl))
  }

  const body = rows
    .map((row, i) => {
      const src = photos[i]
      const photoCell = src
        ? `<img src="${src}" alt="" />`
        : row.snap
          ? xmlEscape(vi.historyHasPhoto)
          : '—'
      return (
        `<tr>` +
        `<td>${xmlEscape(row.tsLabel)}</td>` +
        `<td>${xmlEscape(row.panelName)}</td>` +
        `<td>${xmlEscape(row.idLabel)}</td>` +
        `<td>${xmlEscape(row.label)}</td>` +
        `<td>${xmlEscape(row.section)}</td>` +
        `<td>${xmlEscape(row.status)}</td>` +
        `<td class="photo">${photoCell}</td>` +
        `</tr>`
      )
    })
    .join('')

  const html =
    `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"/>` +
    `<title>${xmlEscape(vi.historyPageTitle)}</title>` +
    `<style>
      body { font-family: "Segoe UI", "IBM Plex Sans", sans-serif; color: #122; margin: 24px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .meta { color: #556; font-size: 12px; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #c5ced6; padding: 6px 8px; text-align: left; vertical-align: middle; }
      th { background: #eef3f7; }
      td.photo img { max-width: 120px; max-height: 72px; display: block; }
      @media print { body { margin: 12px; } }
    </style></head><body>` +
    `<h1>${xmlEscape(vi.historyPageTitle)}</h1>` +
    `<p class="meta">${rows.length} sự kiện · ${new Date().toLocaleString('vi-VN')} · GMT+07</p>` +
    `<table><thead><tr>${HEADERS.map((h) => `<th>${xmlEscape(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${body || `<tr><td colspan="7">${xmlEscape(vi.noHistory)}</td></tr>`}</tbody></table>` +
    `<script>window.onload = function () { window.print(); }</script>` +
    `</body></html>`

  const w = window.open('', '_blank')
  if (!w) throw new Error('Trình duyệt chặn cửa sổ in. Hãy cho phép popup rồi thử lại.')
  w.document.open()
  w.document.write(html)
  w.document.close()
}
