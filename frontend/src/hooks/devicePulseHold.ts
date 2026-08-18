import type { Device } from '../api/client'

/** Min time Map / Devices page show pulse ACT (JA-110P) before settling to OK. */
export const PULSE_UI_HOLD_MS = 2000

const ACTIVE_RANK: Record<string, number> = {
  ok: 0,
  open: 1,
  fault: 2,
  loss: 3,
  tamper: 4,
  alarm: 5,
}

export function deviceStateRank(state: string | undefined | null): number {
  return ACTIVE_RANK[(state || 'ok').toLowerCase()] ?? 0
}

export function isPulseVisibleState(state: string | undefined | null): boolean {
  return deviceStateRank(state) >= 1
}

type HoldEntry = {
  /** State painted on UI while hold is active. */
  holdState: string
  holdDisable: string
  until: number
  /** State to apply when hold expires. */
  settleState: string
  settleDisable: string
  timer: number
}

/**
 * Holds brief ACT/TMP/alarm on UI when WS coalesces open→ok in one React tick
 * (EventFeed still logs both; Map/Devices would otherwise skip ACT).
 */
export class DevicePulseHold {
  private holds = new Map<string, HoldEntry>()

  clearAll(): void {
    for (const h of this.holds.values()) window.clearTimeout(h.timer)
    this.holds.clear()
  }

  /** After a batch of WS patches: keep peak active state visible for PULSE_UI_HOLD_MS. */
  applyPeakHold(
    devices: Device[],
    peakById: Map<string, { state: string; disable: string }>,
    onSettle: (deviceId: string, state: string, disable: string) => void,
  ): { devices: Device[]; heldIds: string[] } {
    if (!peakById.size) return { devices, heldIds: [] }

    let next = devices
    const heldIds: string[] = []
    const byId = new Map(next.map((d) => [d.global_id, d]))

    for (const [id, peak] of peakById) {
      const cur = byId.get(id)
      if (!cur) continue
      const peakRank = deviceStateRank(peak.state)
      const curRank = deviceStateRank(cur.state)
      // Only when batch coalesced away a visible pulse (ACT→OK in one drain).
      if (peakRank < 1 || peakRank <= curRank) continue

      next = next.map((d) =>
        d.global_id === id
          ? { ...d, state: peak.state, disable: peak.disable || d.disable || 'none' }
          : d,
      )
      byId.set(id, {
        ...cur,
        state: peak.state,
        disable: peak.disable || cur.disable || 'none',
      })
      heldIds.push(id)
      this._arm(
        id,
        peak.state,
        peak.disable || cur.disable || 'none',
        cur.state || 'ok',
        cur.disable || 'none',
        onSettle,
      )
    }

    return { devices: next, heldIds }
  }

  /**
   * Called on active→quiet transitions. Keeps ACT/TMP painted for PULSE_UI_HOLD_MS
   * so Map/Devices catch JA-110P pulses that EventFeed already logged.
   *
   * Do not extend the window forever on open↔ok chatter — first quiet event
   * starts the hold; later OKs only refresh settleState.
   */
  suppressEarlyOk(
    devices: Device[],
    deviceId: string,
    prevState: string,
    prevDisable: string,
    nextState: string,
    nextDisable: string,
    onSettle: (deviceId: string, state: string, disable: string) => void,
  ): Device[] {
    if (deviceStateRank(nextState) >= 1) return devices

    const hold = this.holds.get(deviceId)
    const holdState = hold?.holdState || prevState
    const holdDisable = hold?.holdDisable || prevDisable || 'none'
    if (!isPulseVisibleState(holdState)) return devices

    if (hold) {
      // Already holding — update settle target, do not restart the clock
      // (Dev_09 open/ok spam was freezing ACT forever).
      hold.settleState = nextState || 'ok'
      hold.settleDisable = nextDisable || 'none'
      return devices.map((d) =>
        d.global_id === deviceId ? { ...d, state: holdState, disable: holdDisable } : d,
      )
    }

    this.holds.set(deviceId, {
      holdState,
      holdDisable,
      until: Date.now() + PULSE_UI_HOLD_MS,
      settleState: nextState || 'ok',
      settleDisable: nextDisable || 'none',
      timer: 0,
    })
    this._rearmTimer(deviceId, onSettle)

    return devices.map((d) =>
      d.global_id === deviceId ? { ...d, state: holdState, disable: holdDisable } : d,
    )
  }

  /** REST refresh must not wipe an in-flight pulse ACT paint. */
  mergeRestDevices(fromRest: Device[]): Device[] {
    if (!this.holds.size) return fromRest
    const now = Date.now()
    return fromRest.map((d) => {
      const hold = this.holds.get(d.global_id)
      if (!hold || now >= hold.until) return d
      if (deviceStateRank(hold.holdState) > deviceStateRank(d.state)) {
        return { ...d, state: hold.holdState, disable: hold.holdDisable }
      }
      return d
    })
  }

  private _arm(
    id: string,
    holdState: string,
    holdDisable: string,
    settleState: string,
    settleDisable: string,
    onSettle: (deviceId: string, state: string, disable: string) => void,
  ): void {
    const prev = this.holds.get(id)
    if (prev) window.clearTimeout(prev.timer)
    // Always extend the visible ACT window when activity refreshes.
    const entry: HoldEntry = {
      holdState,
      holdDisable,
      until: Date.now() + PULSE_UI_HOLD_MS,
      settleState,
      settleDisable,
      timer: 0,
    }
    this.holds.set(id, entry)
    this._rearmTimer(id, onSettle)
  }

  private _rearmTimer(
    id: string,
    onSettle: (deviceId: string, state: string, disable: string) => void,
  ): void {
    const hold = this.holds.get(id)
    if (!hold) return
    if (hold.timer) window.clearTimeout(hold.timer)
    const delay = Math.max(0, hold.until - Date.now())
    hold.timer = window.setTimeout(() => {
      const cur = this.holds.get(id)
      if (!cur) return
      this.holds.delete(id)
      onSettle(id, cur.settleState, cur.settleDisable)
    }, delay)
  }

  /** Tắt báo động / PIN — bỏ hold ACT/alarm để REST/WS không sơn lại. */
  release(id: string): void {
    this._clear(id)
  }

  private _clear(id: string): void {
    const h = this.holds.get(id)
    if (h) window.clearTimeout(h.timer)
    this.holds.delete(id)
  }
}
