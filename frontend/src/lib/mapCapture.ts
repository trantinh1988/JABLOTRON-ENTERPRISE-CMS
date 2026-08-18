/** Chụp SVG bản đồ ra JPEG — không thêm thư viện. */

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Không đọc được ảnh.'))
    reader.readAsDataURL(blob)
  })
}

async function hrefToDataUrl(href: string): Promise<string> {
  const abs = new URL(href, window.location.origin).href
  const res = await fetch(abs, { credentials: 'same-origin' })
  if (!res.ok) throw new Error('Không đọc được ảnh nền bản đồ.')
  return blobToDataUrl(await res.blob())
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Không vẽ được ảnh bản đồ.'))
    img.src = url
  })
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Không xuất được JPEG.'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/** Rasterize SVG bản đồ (nền + truy vết + marker) thành JPEG. */
export async function captureSvgJpeg(svg: SVGSVGElement): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.querySelectorAll('animate').forEach((node) => node.remove())

  const images = [...clone.querySelectorAll('image')]
  for (const image of images) {
    const href =
      image.getAttribute('href') ||
      image.getAttribute('xlink:href') ||
      image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      ''
    if (!href || href.startsWith('data:')) continue
    const data = await hrefToDataUrl(href)
    image.setAttribute('href', data)
    image.removeAttribute('xlink:href')
  }

  const vb = svg.viewBox.baseVal
  const vw = vb?.width || svg.clientWidth || 100
  const vh = vb?.height || svg.clientHeight || 70
  const scale = Math.min(MAX_EDGE / vw, MAX_EDGE / vh, 16)
  const outW = Math.max(1, Math.round(vw * scale))
  const outH = Math.max(1, Math.round(vh * scale))
  clone.setAttribute('width', String(outW))
  clone.setAttribute('height', String(outH))

  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Không tạo được canvas.')
    ctx.fillStyle = '#0b1017'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)
    return await canvasToJpeg(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}
