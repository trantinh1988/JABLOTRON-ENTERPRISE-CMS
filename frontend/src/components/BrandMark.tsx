import { useEffect, useState } from 'react'
import { vi } from '../i18n/vi'
import { setDocumentTitleBase } from '../lib/alarmBrowserAlert'
import { DEFAULT_SITE_TITLE, getSiteTitle, hydrateAlertSounds, subscribeSystemSettings } from '../lib/alarmSounds'

type Props = {
  className?: string
  subtitleClass?: string
  titleClass?: string
}

export function BrandMark({ className, subtitleClass, titleClass }: Props) {
  const [title, setTitle] = useState(getSiteTitle)

  useEffect(() => {
    void hydrateAlertSounds()
      .then(() => setTitle(getSiteTitle()))
      .catch(() => undefined)
    return subscribeSystemSettings(() => setTitle(getSiteTitle()))
  }, [])

  useEffect(() => {
    setDocumentTitleBase(title)
  }, [title])

  const custom = title !== DEFAULT_SITE_TITLE

  return (
    <div className={className ?? 'min-w-0 shrink-0'}>
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
  )
}
