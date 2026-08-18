import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  subscribeAlarmMapFocus,
  type AlarmMapFocusRequest,
} from '../hooks/alarmMapFocusBus'
import { alertBrowserOnAlarm } from '../lib/alarmBrowserAlert'

function isMapsPath(pathname: string): boolean {
  return pathname === '/maps' || pathname.endsWith('/maps')
}

/**
 * Khi chưa ở trang bản đồ: điều hướng tới /maps?...
 * Khi đã ở /maps: MapsPage nhận bus trực tiếp — không đi vòng URL (24h focus nhanh hơn).
 */
export function AlarmMapFocus() {
  const navigate = useNavigate()
  const location = useLocation()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  const lastToken = useRef(0)

  useEffect(() => {
    return subscribeAlarmMapFocus((req: AlarmMapFocusRequest) => {
      if (req.token === lastToken.current) return
      lastToken.current = req.token

      if (!isMapsPath(pathRef.current)) {
        navigateRef.current(
          `/maps?map=${req.mapId}&device=${encodeURIComponent(req.deviceId)}&focus=alarm&t=${req.token}`,
        )
      }

      try {
        alertBrowserOnAlarm({
          caption: req.deviceId,
          mapName: `Map #${req.mapId}`,
          onOpen: () => {
            if (!isMapsPath(pathRef.current)) {
              navigateRef.current(
                `/maps?map=${req.mapId}&device=${encodeURIComponent(req.deviceId)}&focus=alarm&t=${req.token}`,
              )
            }
          },
        })
      } catch {
        /* không chặn navigate */
      }
    })
  }, [])

  return null
}
