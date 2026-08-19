/** Gom marker gần nhau trên màn hình — tách ra khi phóng to. */

export type ClusterInput = {
  id: string
  x: number
  y: number
  status: string
}

export type MarkerCluster = {
  id: string
  x: number
  y: number
  memberIds: string[]
  status: string
}

const STATUS_RANK: Record<string, number> = {
  alarm: 6,
  tamper: 5,
  fault: 4,
  loss: 3,
  open: 2,
  ok: 1,
}

export const CLUSTER_GAP_PX = 42

function rank(status: string): number {
  return STATUS_RANK[status] ?? 0
}

function worstStatus(items: ClusterInput[]): string {
  return items.reduce((best, it) => (rank(it.status) > rank(best) ? it.status : best), items[0]?.status ?? 'ok')
}

export function clusterMarkers(
  items: ClusterInput[],
  toScreen: (x: number, y: number) => { x: number; y: number },
  thresholdPx = CLUSTER_GAP_PX,
): MarkerCluster[] {
  if (items.length <= 1 || thresholdPx <= 0) {
    return items.map((it) => ({
      id: it.id,
      x: it.x,
      y: it.y,
      memberIds: [it.id],
      status: it.status,
    }))
  }

  const tagged = items.map((it) => ({ ...it, s: toScreen(it.x, it.y) }))
  const used = new Set<string>()
  const out: MarkerCluster[] = []

  for (const seed of tagged) {
    if (used.has(seed.id)) continue
    const group = [seed]
    used.add(seed.id)
    let grew = true
    while (grew) {
      grew = false
      for (const other of tagged) {
        if (used.has(other.id)) continue
        const near = group.some((g) => {
          const dx = g.s.x - other.s.x
          const dy = g.s.y - other.s.y
          return dx * dx + dy * dy <= thresholdPx * thresholdPx
        })
        if (!near) continue
        group.push(other)
        used.add(other.id)
        grew = true
      }
    }

    const n = group.length
    out.push({
      id: n === 1 ? seed.id : `c:${group.map((g) => g.id).sort().join('+')}`,
      x: group.reduce((s, g) => s + g.x, 0) / n,
      y: group.reduce((s, g) => s + g.y, 0) / n,
      memberIds: group.map((g) => g.id),
      status: worstStatus(group),
    })
  }

  return out
}
