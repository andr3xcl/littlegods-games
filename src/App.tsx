import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Boxes, Gamepad2, Library, Pause, Play, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { es } from './i18n/es'
import { en } from './i18n/en'
import './App.css'

type View = 'library' | 'downloads'
type Download = DownloadProgress & { state: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'; message?: string; logs: string[] }
type Language = 'es' | 'en'
type Theme = 'dark' | 'light' | 'forest' | 'sunset'
type SoundName = 'nav' | 'select' | 'exit'
type SettingsState = {
  defaultFolder: string
  autoResume: boolean
  clearTemp: boolean
  notifications: boolean
  openFolder: boolean
  language: Language
  theme: Theme
  sounds: boolean
}

const defaultSettings: SettingsState = {
  defaultFolder: '',
  autoResume: true,
  clearTemp: true,
  notifications: true,
  openFolder: true,
  language: 'es',
  theme: 'dark',
  sounds: true,
}

const formatBytes = (value: number) => {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}
const formatSpeed = (value: number) => `${formatBytes(value)}/s`

function App() {
  const [view, setView] = useState<View>('library')
  const [games, setGames] = useState<Game[]>([])
  const [downloads, setDownloads] = useState<Record<string, Download>>({})
  const [query, setQuery] = useState('')
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [folder, setFolder] = useState('')
  const [notice, setNotice] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [installedGames, setInstalledGames] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('littlegods-installed-games')
    if (!saved) return {}
    try { return JSON.parse(saved) } catch { return {} }
  })
  const [settings, setSettings] = useState<SettingsState>(() => {
    const saved = localStorage.getItem('littlegods-settings')
    if (!saved) return defaultSettings
    try {
      return { ...defaultSettings, ...JSON.parse(saved) }
    } catch {
      return defaultSettings
    }
  })
  const t = settings.language === 'es' ? es : en
  const listenersRegistered = useRef(false)
  const soundRefs = useRef<Record<SoundName, HTMLAudioElement> | null>(null)

  if (!soundRefs.current) {
    soundRefs.current = {
      nav: new Audio('./sound/cac_grid_nav.wav'),
      select: new Audio('./sound/cac_grid_select.wav'),
      exit: new Audio('./sound/cac_exit.wav'),
    }
  }

  const playSound = (name: SoundName) => {
    if (!settings.sounds || !soundRefs.current) return
    const audio = soundRefs.current[name]
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }

  const handleUiMouseOver = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const control = target.closest<HTMLElement>('[data-sound="nav"]')
    const related = event.relatedTarget as Node | null
    if (control && (!related || !control.contains(related))) playSound('nav')
  }

  const handleUiClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const control = target.closest<HTMLElement>('[data-sound]')
    if (!control) return
    playSound(control.dataset.sound === 'exit' ? 'exit' : 'select')
  }

  useEffect(() => {
    localStorage.setItem('littlegods-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem('littlegods-installed-games', JSON.stringify(installedGames))
  }, [installedGames])

  useEffect(() => {
    let active = true
    const validateInstalledGames = async () => {
      const entries = await Promise.all(Object.entries(installedGames).map(async ([id, gamePath]) => [id, await window.launcher.folderExists(gamePath) ? gamePath : null] as const))
      if (!active) return
      const validEntries = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
      if (Object.keys(validEntries).length !== Object.keys(installedGames).length) setInstalledGames(validEntries)
    }
    void validateInstalledGames()
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    if (listenersRegistered.current) return
    listenersRegistered.current = true
    window.launcher.listGames().then(setGames).catch(() => setNotice(t.messages.catalogError))
    window.launcher.onUpdateStatus(({ state, version, percent }) => {
      if (state === 'available') setNotice(t.common.updateFound(version || ''))
      if (state === 'downloading') setNotice(t.common.updateProgress(Math.round(percent || 0)))
      if (state === 'downloaded') setNotice(t.common.updateReady(version || ''))
    })
    window.launcher.onPrepared(({ destination }) => setNotice(t.messages.torrentPrepared(destination)))
    window.launcher.onLog(({ id, message }) => setDownloads((items) => ({
      ...items,
      [id]: {
        ...items[id],
        logs: [...(items[id]?.logs || []), message].slice(-12),
      },
    })))
    window.launcher.onProgress((payload) => setDownloads((items) => ({
      ...items,
      [payload.id]: {
        ...items[payload.id],
        ...payload,
        state: items[payload.id]?.state === 'paused' ? 'paused' : 'downloading',
        logs: items[payload.id]?.logs || [],
      },
    })))
    window.launcher.onDone(({ id, path }) => {
      setInstalledGames((items) => ({ ...items, [id]: path }))
      setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'done', progress: 1, logs: [...(items[id]?.logs || []), t.messages.completed].slice(-25) } }))
    })
    window.launcher.onCancelled(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'cancelled', logs: [...(items[id]?.logs || []), t.messages.cancelled] } })))
    window.launcher.onPaused(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'paused', logs: [...(items[id]?.logs || []), t.messages.paused] } })))
    window.launcher.onResumed(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'downloading', logs: [...(items[id]?.logs || []), t.messages.resumed] } })))
    window.launcher.onError(({ id, message }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'error', message, logs: [...(items[id]?.logs || []), t.messages.error(message)] } })))
  }, [t])

  const filteredGames = useMemo(() => games.filter((game) => `${game.name} ${game.genre}`.toLowerCase().includes(query.toLowerCase())), [games, query])
  const activeDownloads = Object.values(downloads).filter((download) => download.state === 'downloading' || download.state === 'paused')
  const applyDefaultFolder = async () => {
    const desiredFolder = settings.defaultFolder || folder
    if (desiredFolder && await window.launcher.folderExists(desiredFolder)) {
      setFolder(desiredFolder)
      return desiredFolder
    }
    const defaultPath = await window.launcher.defaultFolder()
    if (defaultPath && await window.launcher.folderExists(defaultPath)) {
      setSettings((current) => ({ ...current, defaultFolder: defaultPath }))
      setFolder(defaultPath)
      return defaultPath
    }
    const picked = await window.launcher.pickFolder()
    if (picked) {
      setSettings((current) => ({ ...current, defaultFolder: picked }))
      setFolder(picked)
      return picked
    }
    return null
  }
  const clearTemporaryFiles = async () => {
    if (!settings.clearTemp) return
    const tempFolder = window.localStorage.getItem('littlegods-temp-cleanup')
    if (tempFolder) {
      setNotice(t.messages.cleanupDone)
    }
  }
  const downloadGame = async (game: Game, destinationOverride?: string) => {
    const destination = destinationOverride || folder || settings.defaultFolder || await applyDefaultFolder()
    if (!destination) {
      setNotice(t.messages.chooseFolder)
      return
    }
    setFolder(destination); setSelectedGame(null); setView('downloads')
    setDownloads((items) => ({ ...items, [game.id]: { id: game.id, progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0, state: 'downloading', logs: [`${t.game.install}: ${game.name}`, t.messages.preparing(game.name)] } }))
    setNotice(t.messages.preparing(game.name))
    setNotice(t.messages.installing(game.name, destination))
    const result = await window.launcher.startDownload({ id: game.id, torrentPath: game.torrentPath, destination })
    if (!result.ok) setNotice(result.message || t.messages.downloadError)
  }
  const pauseDownload = async (id: string) => {
    const changed = await window.launcher.pauseDownload(id)
    if (changed) setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'paused' } }))
  }
  const resumeDownload = async (id: string) => {
    const changed = await window.launcher.resumeDownload(id)
    if (changed) setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'downloading' } }))
  }
  const finishDelete = async (removeFiles: boolean) => {
    if (!pendingDelete) return
    const id = pendingDelete
    if (removeFiles) {
      await window.launcher.deleteDownload(id)
      setInstalledGames((items) => {
        const next = { ...items }
        delete next[id]
        return next
      })
    } else {
      await window.launcher.cancelDownload(id)
    }
    setDownloads((items) => {
      const next = { ...items }
      delete next[id]
      return next
    })
    setPendingDelete(null)
  }
  const handleFolderSelection = async () => {
    const picked = await window.launcher.pickFolder()
    if (picked) {
      setFolder(picked)
      setSettings((current) => ({ ...current, defaultFolder: picked }))
    }
  }
  const toggleSetting = (key: keyof SettingsState, value: boolean) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }
  const openGameFolder = async (gameId: string) => {
    const gamePath = installedGames[gameId]
    if (gamePath) await window.launcher.openFolder(gamePath)
  }

  return <div className="shell" onMouseOver={handleUiMouseOver} onClick={handleUiClick}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Gamepad2 size={20} /></div><span>LITTLE<span>GODS</span></span></div>
      <nav>
        <button data-sound="nav" className={view === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setView('library')}><Library size={18} /> {t.nav.library} <span>{games.length}</span></button>
        <button data-sound="nav" className={view === 'downloads' ? 'nav-item active' : 'nav-item'} onClick={() => setView('downloads')}><ArrowDownToLine size={18} /> {t.nav.downloads} <span>{activeDownloads.length || ''}</span></button>
      </nav>
      <div className="sidebar-bottom"><button data-sound="nav" className="nav-item muted" onClick={() => setShowSettings(true)}><Settings2 size={18} /> {t.nav.preferences}</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="section-kicker">{t.common.official}</div><h1>{view === 'library' ? t.library.title : t.common.downloadQueue}</h1></div><div className="top-actions"><div className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.library.search} /></div><button data-sound="select" className="icon-button" title={t.library.refresh} onClick={() => window.launcher.listGames().then(setGames)}><RefreshCw size={17} /></button></div></header>
      {notice && <div className="notice"><Sparkles size={16} />{notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
      {view === 'library' ? <>
        <section className="hero-card"><div className="hero-copy"><div className="hero-tag"><Sparkles size={14} /> {t.hero.catalog}</div><h2>{t.hero.title}</h2><p>{t.hero.description}</p><button data-sound="select" className="hero-button" onClick={() => setView('downloads')}>{t.hero.button} <ArrowDownToLine size={16} /></button></div><div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><img className="hero-logo" src="./imagen/littlegods.webp" alt="Littlegods Games" /></div></section>
        <div className="section-heading installed-heading"><div><h2>{t.library.installedTitle}</h2><p>{t.library.installedEmpty}</p></div><div className="library-meta"><ShieldCheck size={16} /> {Object.keys(installedGames).length}</div></div>
        {Object.keys(installedGames).length ? <div className="game-grid">{games.filter((game) => installedGames[game.id]).map((game) => <article data-sound="nav" className="game-card installed" key={`installed-${game.id}`} onClick={() => setSelectedGame(game)}><div className="game-cover"><img className="game-banner" src={game.bannerUrl} alt={`Banner ${game.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} /><Gamepad2 className="cover-fallback" size={34} /><span>{t.library.installed}</span></div><div className="game-info"><div><h3>{game.name}</h3><p>{game.description}</p></div><button data-sound="select" className="download-button" title={t.library.settings} onClick={(event) => { event.stopPropagation(); setSelectedGame(game) }}><Settings2 size={16} /></button></div></article>)}</div> : null}
        <div className="section-heading"><div><h2>{t.library.title}</h2><p>{games.length ? t.library.count(games.length) : t.library.emptyCount}</p></div><div className="library-meta"><ShieldCheck size={16} /> {t.library.local}</div></div>
        {filteredGames.length ? <div className="game-grid">{filteredGames.map((game) => { const installed = Boolean(installedGames[game.id]); return <article data-sound="nav" className={`game-card${installed ? ' installed' : ''}`} key={game.id} onClick={() => setSelectedGame(game)}><div className="game-cover"><img className="game-banner" src={game.bannerUrl} alt={`Banner ${game.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} /><Gamepad2 className="cover-fallback" size={34} /><span>{installed ? t.library.installed : game.genre}</span></div><div className="game-info"><div><h3>{game.name}</h3><p>{game.description}</p></div><button data-sound="select" className="download-button" title={installed ? t.library.settings : t.library.install} onClick={(event) => { event.stopPropagation(); setSelectedGame(game) }}>{installed ? <Settings2 size={16} /> : <ArrowDownToLine size={16} />}</button></div></article> })}</div> : <div className="empty-state"><Boxes size={34} /><h3>{t.library.emptyTitle}</h3><p>{t.library.emptyDescription}</p></div>}
      </> : <section className="downloads-view"><div className="download-head"><div><h2>{t.downloads.title}</h2>{folder && <p className="install-path">{t.downloads.folder}: {folder}</p>}</div></div>{Object.values(downloads).length ? Object.values(downloads).map((download) => { const game = games.find((item) => item.id === download.id); return <div className="download-row" key={download.id}><div className="mini-cover"><Gamepad2 size={20} /></div><div className="download-main"><div className="download-title"><strong>{game?.name || t.common.game}</strong><span>{download.state === 'downloading' ? `${Math.round(download.progress * 100)}%` : download.state}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(download.progress * 100, 1)}%` }} /></div><div className="download-stats"><span>{formatSpeed(download.speed)}</span><span>{download.peers} {t.downloads.peers}</span><span>{formatBytes(download.downloaded)} / {formatBytes(download.total)} {t.downloads.total}</span></div><div className="torrent-log">{download.logs.map((log, index) => <div key={`${download.id}-${index}`}>{log}</div>)}</div></div><div className="download-actions"><button data-sound="select" className="pause-button" title={download.state === 'paused' ? t.downloads.resume : t.downloads.pause} onClick={() => download.state === 'paused' ? resumeDownload(download.id) : pauseDownload(download.id)}>{download.state === 'paused' ? <Play size={16} /> : <Pause size={16} />}</button><button data-sound="select" className="pause-button danger" title={t.downloads.delete} onClick={() => setPendingDelete(download.id)}>X</button></div></div> }) : <div className="empty-state"><ArrowDownToLine size={34} /><h3>{t.downloads.empty}</h3><p>{t.downloads.emptyDescription}</p></div>}</section>}
    </main>
    {selectedGame && <div data-sound="exit" className="modal-backdrop" onClick={() => setSelectedGame(null)}><section className="modal detail-modal" onClick={(event) => event.stopPropagation()}><div className="game-cover large"><img className="game-banner" src={selectedGame.bannerUrl} alt="" /><Gamepad2 className="cover-fallback" size={58} /></div><div className="section-kicker">{installedGames[selectedGame.id] ? t.game.installedTitle : t.game.installTitle}</div><h2>{selectedGame.name}</h2><p>{selectedGame.description}</p>{installedGames[selectedGame.id] ? <div className="installed-panel"><span>{t.game.installPath}</span><strong>{installedGames[selectedGame.id]}</strong><button data-sound="select" className="secondary-button" onClick={() => openGameFolder(selectedGame.id)}>{t.game.openFolder}</button></div> : <button data-sound="select" className="hero-button" onClick={() => downloadGame(selectedGame)}>{t.game.install} <ArrowDownToLine size={16} /></button>}</section></div>}
    {pendingDelete && <div data-sound="exit" className="modal-backdrop" onClick={() => setPendingDelete(null)}><section className="modal remove-modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><div className="section-kicker">{t.downloads.delete}</div><h2>{t.downloads.removeTitle}</h2></div><button data-sound="exit" className="close-button" onClick={() => setPendingDelete(null)}><X size={16} /></button></div><p className="remove-description">{t.downloads.keepDescription}</p><div className="remove-actions"><button data-sound="select" className="secondary-button" onClick={() => finishDelete(false)}>{t.downloads.keepFiles}</button><button data-sound="select" className="danger-button" onClick={() => finishDelete(true)}>{t.downloads.deleteFiles}</button></div><p className="remove-warning">{t.downloads.deleteDescription}</p></section></div>}
    {showSettings && <div data-sound="exit" className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="modal settings-modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><div className="section-kicker">{t.nav.preferences}</div><h2>{t.settings.title}</h2></div><button data-sound="exit" className="close-button" onClick={() => setShowSettings(false)}><X size={16} /></button></div><div className="settings-list"><label className="settings-row"><span>{t.settings.language}</span><select data-sound="select" value={settings.language} onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value as Language }))}><option value="es">{t.settings.spanish}</option><option value="en">{t.settings.english}</option></select></label><label className="settings-row"><span>{t.settings.theme}</span><select data-sound="select" value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as Theme }))}><option value="dark">{t.settings.dark}</option><option value="light">{t.settings.light}</option><option value="forest">{t.settings.forest}</option><option value="sunset">{t.settings.sunset}</option></select></label><label className="settings-row"><span>{t.settings.defaultFolder}</span><div className="settings-actions"><input value={settings.defaultFolder || t.settings.none} readOnly /><button data-sound="select" className="secondary-button" onClick={handleFolderSelection}>{t.settings.chooseFolder}</button></div></label><label className="settings-row switch-row"><span>{t.settings.autoResume}</span><input data-sound="select" type="checkbox" checked={settings.autoResume} onChange={(event) => toggleSetting('autoResume', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.clearTemp}</span><input data-sound="select" type="checkbox" checked={settings.clearTemp} onChange={(event) => toggleSetting('clearTemp', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.notifications}</span><input data-sound="select" type="checkbox" checked={settings.notifications} onChange={(event) => toggleSetting('notifications', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.openFolder}</span><input data-sound="select" type="checkbox" checked={settings.openFolder} onChange={(event) => toggleSetting('openFolder', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.sounds}</span><input data-sound="select" type="checkbox" checked={settings.sounds} onChange={(event) => toggleSetting('sounds', event.target.checked)} /></label></div><div className="modal-foot"><button data-sound="select" className="secondary-button" onClick={clearTemporaryFiles}>{t.settings.clearNow}</button><button data-sound="exit" className="hero-button" onClick={() => setShowSettings(false)}>{t.settings.close}</button></div></section></div>}
  </div>
}

export default App
