import { useEffect, useState } from 'react'
import { vi } from '../i18n/vi'
import { setDocumentTitleBase } from '../lib/alarmBrowserAlert'
import {
  DEFAULT_SITE_TITLE,
  getSiteLogoUrl,
  getSiteTitle,
  hydrateAlertSounds,
  subscribeSystemSettings,
} from '../lib/alarmSounds'

type Props = {
  className?: string
  subtitleClass?: string
  titleClass?: string
}

export function BrandMark({ className, subtitleClass, titleClass }: Props) {
  const [title, setTitle] = useState(getSiteTitle)
  const [logoUrl, setLogoUrl] = useState(getSiteLogoUrl)

  useEffect(() => {
    void hydrateAlertSounds()
      .then(() => {
        setTitle(getSiteTitle())
        setLogoUrl(getSiteLogoUrl())
      })
      .catch(() => undefined)
    return subscribeSystemSettings(() => {
      setTitle(getSiteTitle())
      setLogoUrl(getSiteLogoUrl())
    })
  }, [])

  useEffect(() => {
    setDocumentTitleBase(title)
    const api = window.pywebview?.api
    if (api && typeof api.refresh_branding === 'function') {
      void api.refresh_branding(title).catch(() => undefined)
    }
  }, [title, logoUrl])

  const custom = title !== DEFAULT_SITE_TITLE

  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${className ?? 'shrink-0'}`}>
      <img
        src={logoUrl || '/favicon.svg'}
        alt=""
        className="size-9 shrink-0 rounded-md bg-fog object-contain ring-1 ring-line/80"
      />
      <div className="min-w-0">
        <p
          className={
            subtitleClass ??
            'font-mono text-[9px] tracking-[0.14em] text-steel/60 uppercase leading-none'
          }
        >
          {vi.brandSubtitle}
        </p>
        <h1
          className={
            titleClass ?? 'mt-0.5 truncate text-sm font-semibold tracking-tight text-ink sm:text-[15px]'
          }
          title={title}
        >
          {custom ? (
            <span className="text-accent">{title}</span>
          ) : (
            <>
              {vi.brandTitle} <span className="text-accent">{vi.brandAccent}</span>
            </>
          )}
        </h1>
      </div>
    </div>
  )
}
