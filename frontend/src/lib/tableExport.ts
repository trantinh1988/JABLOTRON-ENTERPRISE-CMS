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

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2_000)
}

export function reportStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function sheetXml(headers: string[], rows: string[][], colWidths: number[]): string {
  const cols = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')
  const header = headers
    .map((h, i) => {
      const ref = `${colLetter(i)}1`
      return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(h)}</t></is></c>`
    })
    .join('')
  const body = rows
    .map((row, ri) => {
      const r = ri + 2
      const cells = row
        .map((val, i) => {
          const ref = `${colLetter(i)}${r}`
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>`
        })
        .join('')
      return `<row r="${r}">${cells}</row>`
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<cols>${cols}</cols><sheetData>` +
    `<row r="1">${header}</row>${body}</sheetData></worksheet>`
  )
}

export function exportTableExcel(opts: {
  filename: string
  sheetName: string
  headers: string[]
  rows: string[][]
  colWidths?: number[]
}): void {
  const widths = opts.colWidths ?? opts.headers.map(() => 18)
  const files: { name: string; data: Uint8Array }[] = [
    {
      name: '[Content_Types].xml',
      data: ENC.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
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
          `<sheets><sheet name="${xmlEscape(opts.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
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
    { name: 'xl/worksheets/sheet1.xml', data: ENC.encode(sheetXml(opts.headers, opts.rows, widths)) },
  ]
  downloadBlob(zipStore(files), opts.filename)
}

export function exportTablePdf(opts: {
  title: string
  meta: string
  headers: string[]
  rows: string[][]
  emptyText: string
}): void {
  const body = opts.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${xmlEscape(cell)}</td>`).join('')}</tr>`,
    )
    .join('')
  const html =
    `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"/>` +
    `<title>${xmlEscape(opts.title)}</title>` +
    `<style>
      @page { size: landscape; margin: 12mm; }
      body { font-family: "Segoe UI", "IBM Plex Sans", sans-serif; color: #122; margin: 24px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .meta { color: #556; font-size: 12px; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #c5ced6; padding: 6px 8px; text-align: left; vertical-align: middle; }
      th { background: #eef3f7; }
      @media print { body { margin: 12px; } }
    </style></head><body>` +
    `<h1>${xmlEscape(opts.title)}</h1>` +
    `<p class="meta">${xmlEscape(opts.meta)}</p>` +
    `<table><thead><tr>${opts.headers.map((h) => `<th>${xmlEscape(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${body || `<tr><td colspan="${opts.headers.length}">${xmlEscape(opts.emptyText)}</td></tr>`}</tbody></table>` +
    `<script>window.onload = function () { window.print(); }</script>` +
    `</body></html>`

  const w = window.open('', '_blank')
  if (!w) throw new Error('Trình duyệt chặn cửa sổ in. Hãy cho phép popup rồi thử lại.')
  w.document.open()
  w.document.write(html)
  w.document.close()
}
