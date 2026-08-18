from pathlib import Path

path = Path(r"E:\JABLOTRON-ENTERPRISE-CMS\frontend\src\pages\MapsPage.tsx")
text = path.read_text(encoding="utf-8")
start = text.index("  const toolbar = (")
end = text.index("  const sidebar = (")

new = r'''  const toolBtn =
    'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-steel ring-1 ring-line/80 transition hover:bg-fog hover:text-ink disabled:opacity-40'
  const segWrap = 'inline-flex items-center rounded-md bg-mist/70 p-0.5 ring-1 ring-line/60'
  const segBtn = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none transition ${
      active ? 'bg-accent text-panel' : 'text-steel hover:bg-fog/80 hover:text-ink'
    }`

  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {maps.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setActiveId(m.id)
              setSelectedId(null)
              setPlacingId(null)
              setEditingMeta(false)
            }}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition ${
              active?.id === m.id
                ? 'bg-accent/15 text-accent ring-accent/35'
                : 'bg-mist/70 text-steel ring-line/60 hover:text-ink'
            }`}
          >
            <span className="max-w-[7rem] truncate">{m.name}</span>
            <span className="font-mono text-[10px] opacity-55">{m.device_count}</span>
          </button>
        ))}
        {!maps.length && <span className="text-[11px] text-steel/50">{vi.noMaps}</span>}
      </div>

      <div className={segWrap} role="group" aria-label={vi.mapLabelModeHint} title={vi.mapLabelModeHint}>
        {MAP_MARKER_LABEL_MODES.map((mode) => (
          <button key={mode} type="button" onClick={() => setLabelMode(mode)} className={segBtn(labelMode === mode)}>
            {MODE_LABEL[mode]}
          </button>
        ))}
      </div>

      {canEdit && active?.background_url && (
        <div className={segWrap} role="group" aria-label={vi.mapBgFitHint} title={vi.mapBgFitHint}>
          {MAP_BG_FIT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() =>
                mode === 'manual' ? patchBgFit({ mode: 'manual' }) : patchBgFit({ mode, rect: null })
              }
              className={segBtn(bgFit.mode === mode)}
            >
              {BG_FIT_LABEL[mode]}
            </button>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <input
            ref={bgInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void handleBackgroundFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className={toolBtn}
            disabled={!active || busy}
            title={active?.background_url ? vi.changeMapImage : vi.chooseMapImage}
            onClick={() => bgInputRef.current?.click()}
          >
            <ImagePlus className="size-3.5" />
          </button>
          {active?.background_url && (
            <>
              <button
                type="button"
                className={toolBtn}
                disabled={busy}
                title={vi.removeMapImage}
                onClick={() => void handleClearBackground()}
              >
                <ImageOff className="size-3.5" />
              </button>
              <button
                type="button"
                className={`${toolBtn} !w-auto px-1.5 text-[10px] font-semibold`}
                disabled={busy}
                title={vi.mapBgSyncAspect}
                onClick={() => void syncMapAspectToBackground()}
              >
                {vi.mapBgFitFit}
              </button>
            </>
          )}
          <button
            type="button"
            className={toolBtn}
            disabled={!active}
            title={vi.editMap}
            onClick={() => {
              setEditingMeta(true)
              setCreating(false)
            }}
          >
            <Settings2 className="size-3.5" />
          </button>
          <button
            type="button"
            className={`${toolBtn} text-danger hover:bg-danger/10`}
            disabled={!active || busy}
            title={vi.deleteMap}
            onClick={() => void handleDelete()}
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            className={`${toolBtn} bg-accent/15 text-accent ring-accent/30`}
            title={vi.addMap}
            onClick={() => {
              setCreating(true)
              setEditingMeta(false)
              setPendingBgFile(null)
            }}
          >
            <Plus className="size-3.5" />
          </button>
        </>
      )}

      <span className="mx-0.5 hidden h-4 w-px bg-line/80 sm:inline-block" />

      <button
        type="button"
        disabled={!writeAllowed}
        onClick={() => setEditMode((v) => !v)}
        className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ring-1 transition disabled:opacity-40 ${
          editMode
            ? 'bg-warn/15 text-warn ring-warn/35'
            : 'bg-mist text-steel ring-line/80 hover:text-ink'
        }`}
        title={vi.editModeHint}
      >
        <Pencil className="size-3.5" />
        <span className="hidden sm:inline">{editMode ? vi.editModeOn : vi.editMode}</span>
      </button>

      {!fullscreen && (
        <button
          type="button"
          className={toolBtn}
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? vi.mapCompact : vi.mapExpandSidebar}
        >
          {sidebarOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
        </button>
      )}

      <button
        type="button"
        className={toolBtn}
        onClick={() => setFullscreen((v) => !v)}
        title={fullscreen ? vi.mapExitFullscreen : vi.mapFullscreen}
      >
        {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
    </div>
  )

'''

path.write_text(text[:start] + new + text[end:], encoding="utf-8")
print("ok", end - start, "->", len(new))
