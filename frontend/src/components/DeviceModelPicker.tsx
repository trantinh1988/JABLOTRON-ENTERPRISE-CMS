import { useEffect, useState } from 'react'
import { modelsForFamily, catalogEntry, type DeviceLink } from '../lib/deviceCatalog'
import { vi } from '../i18n/vi'
import { Field, inputClass } from './ui'

const CUSTOM = '__custom__'

type Props = {
  family: string
  model: string
  link: string
  onModelChange: (model: string) => void
  onLinkChange: (link: DeviceLink) => void
}

export function DeviceModelPicker({ family, model, link, onModelChange, onLinkChange }: Props) {
  const options = modelsForFamily(family)
  const [custom, setCustom] = useState(() => Boolean(model && !catalogEntry(model)))

  useEffect(() => {
    setCustom(Boolean(model && !catalogEntry(model)))
  }, [model])

  const selectValue = custom ? CUSTOM : model || ''

  return (
    <>
      <Field label={vi.model}>
        <select
          className={inputClass}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value
            if (v === CUSTOM) {
              setCustom(true)
              return
            }
            setCustom(false)
            if (!v) {
              onModelChange('')
              return
            }
            onModelChange(v)
            const entry = catalogEntry(v)
            if (entry?.link && !link) onLinkChange(entry.link)
          }}
        >
          <option value="">{vi.modelNone}</option>
          {options.map((m) => (
            <option key={m.sku} value={m.sku}>
              {m.sku}
              {m.link === 'rf' ? ' · RF' : m.link === 'bus' ? ' · Bus' : ''}
            </option>
          ))}
          <option value={CUSTOM}>{vi.modelCustom}</option>
        </select>
      </Field>
      {custom && (
        <Field label={vi.modelCustom}>
          <input
            className={inputClass}
            value={model}
            placeholder="JA-…"
            onChange={(e) => onModelChange(e.target.value)}
          />
        </Field>
      )}
      <Field label={vi.link}>
        <select
          className={inputClass}
          value={link || ''}
          onChange={(e) => onLinkChange((e.target.value as DeviceLink) || '')}
        >
          <option value="">{vi.linkUnknown}</option>
          <option value="bus">{vi.linkBus}</option>
          <option value="rf">{vi.linkRf}</option>
        </select>
      </Field>
    </>
  )
}

export function LinkBadge({
  link,
  showEmpty = true,
}: {
  link?: string | null
  showEmpty?: boolean
}) {
  const v = (link || '').toLowerCase()
  if (v === 'rf') {
    return (
      <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold bg-accent/12 text-accent ring-1 ring-accent/25">
        RF
      </span>
    )
  }
  if (v === 'bus') {
    return (
      <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold bg-steel/12 text-steel ring-1 ring-line">
        Bus
      </span>
    )
  }
  if (!showEmpty) return null
  return <span className="font-mono text-[11px] text-steel/40">{vi.linkUnknown}</span>
}
