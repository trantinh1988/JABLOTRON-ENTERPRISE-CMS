import type { CameraBrand } from '../api/client'

export const CAMERA_BRANDS: { id: CameraBrand; label: string }[] = [
  { id: 'hikvision', label: 'Hikvision' },
  { id: 'dahua', label: 'Dahua' },
  { id: 'kbvision', label: 'KBVision' },
  { id: 'ezviz', label: 'Ezviz' },
  { id: 'onvif', label: 'ONVIF' },
  { id: 'generic', label: 'Khác' },
]

export const SNAPSHOT_PATHS: Record<CameraBrand, string[]> = {
  hikvision: [
    '/ISAPI/Streaming/channels/101/picture',
    '/ISAPI/Streaming/channels/1/picture',
    '/Streaming/channels/101/picture',
  ],
  dahua: ['/cgi-bin/snapshot.cgi?channel=1', '/cgi-bin/snapshot.cgi'],
  kbvision: ['/cgi-bin/snapshot.cgi?channel=1', '/cgi-bin/snapshot.cgi'],
  ezviz: ['/ISAPI/Streaming/channels/101/picture', '/onvif/snapshot'],
  onvif: ['/onvif/snapshot', '/ISAPI/Streaming/channels/101/picture'],
  generic: ['/cgi-bin/snapshot.cgi', '/ISAPI/Streaming/channels/101/picture'],
}

export const SNAPSHOT_HINT: Record<CameraBrand, string> = {
  hikvision: 'http://192.168.1.64/ISAPI/Streaming/channels/101/picture',
  dahua: 'http://192.168.1.108/cgi-bin/snapshot.cgi?channel=1',
  kbvision: 'http://192.168.1.108/cgi-bin/snapshot.cgi',
  ezviz: 'http://192.168.1.64/ISAPI/Streaming/channels/101/picture',
  onvif: 'http://192.168.1.50/onvif/snapshot',
  generic: 'http://192.168.1.50/cgi-bin/snapshot.cgi',
}

export const RTSP_HINT: Record<CameraBrand, string> = {
  hikvision: 'rtsp://admin:pass@192.168.1.64:554/Streaming/Channels/101',
  dahua: 'rtsp://admin:pass@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0',
  kbvision: 'rtsp://admin:pass@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0',
  ezviz: 'rtsp://admin:pass@192.168.1.64:554/h264/ch1/main/av_stream',
  onvif: 'rtsp://admin:pass@192.168.1.50:554/Streaming/Channels/101',
  generic: 'rtsp://admin:pass@192.168.1.50:554/stream1',
}

export function brandLabel(brand: string | null | undefined): string {
  const found = CAMERA_BRANDS.find((b) => b.id === brand)
  return found?.label ?? brand ?? 'Khác'
}

export function previewSrc(contentType: string | null | undefined, imageBase64: string): string {
  const mime = contentType && contentType.startsWith('image/') ? contentType : 'image/jpeg'
  return `data:${mime};base64,${imageBase64}`
}

export function normalizeHost(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
    const u = new URL(withScheme)
    return u.port && u.port !== '80' && u.port !== '443' ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return text.replace(/^https?:\/\//i, '').split('/')[0] ?? ''
  }
}

export function hostFromUrl(url: string | null | undefined): string {
  const text = (url || '').trim()
  if (!text) return ''
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
    const u = new URL(withScheme)
    return u.port && u.port !== '80' && u.port !== '443' ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return ''
  }
}

export function buildSnapshotUrl(brand: CameraBrand, host: string, pathIndex = 0): string {
  const ip = normalizeHost(host)
  if (!ip) return ''
  const paths = SNAPSHOT_PATHS[brand] ?? SNAPSHOT_PATHS.generic
  const path = paths[Math.min(pathIndex, paths.length - 1)]
  return `http://${ip}${path}`
}

export function snapshotCandidates(brand: CameraBrand, host: string): string[] {
  const ip = normalizeHost(host)
  if (!ip) return []
  const paths = SNAPSHOT_PATHS[brand] ?? SNAPSHOT_PATHS.generic
  return paths.map((path) => `http://${ip}${path}`)
}

export function isGeneratedSnapshot(brand: CameraBrand, host: string, url: string): boolean {
  const built = snapshotCandidates(brand, host)
  return built.includes(url.trim())
}
