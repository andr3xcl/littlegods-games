import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Boxes, Gamepad2, HardDriveDownload, Library, Pause, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { es } from './i18n/es'
import './App.css'

type View = 'library' | 'downloads'
type Download = DownloadProgress & { state: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'; message?: string; logs: string[] }
type SettingsState = {
  defaultFolder: string
  autoResume: boolean
  clearTemp: boolean
  notifications: boolean
  openFolder: boolean
}

const t = es
const defaultSettings: SettingsState = {
  defaultFolder: '',
  autoResume: true,
  clearTemp: true,
  notifications: true,
  openFolder: true,
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
  const [settings, setSettings] = useState<SettingsState>(() => {
    const saved = localStorage.getItem('littlegods-settings')
    if (!saved) return defaultSettings
    try {
      return { ...defaultSettings, ...JSON.parse(saved) }
    } catch {
      return defaultSettings
    }
  })
  const listenersRegistered = useRef(false)

  useEffect(() => {
    localStorage.setItem('littlegods-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (listenersRegistered.current) return
    listenersRegistered.current = true
    window.launcher.listGames().then(setGames).catch(() => setNotice('No se pudo leer el catálogo oficial. Comprueba tu conexión.'))
    window.launcher.onPrepared(({ destination }) => setNotice(`Torrent preparado. Descargando en los datos de la aplicación: ${destination}`))
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
        state: 'downloading',
        logs: items[payload.id]?.logs || [],
      },
    })))
    window.launcher.onDone(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'done', progress: 1, logs: [...(items[id]?.logs || []), 'Instalación completada: todos los archivos están listos.'].slice(-25) } })))
    window.launcher.onCancelled(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'cancelled', logs: [...(items[id]?.logs || []), 'Instalación cancelada.'] } })))
    window.launcher.onPaused(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'paused', logs: [...(items[id]?.logs || []), 'Descarga pausada.'] } })))
    window.launcher.onResumed(({ id }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'downloading', logs: [...(items[id]?.logs || []), 'Descarga reanudada.'] } })))
    window.launcher.onError(({ id, message }) => setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'error', message, logs: [...(items[id]?.logs || []), `ERROR: ${message}`] } })))
  }, [])

  const filteredGames = useMemo(() => games.filter((game) => `${game.name} ${game.genre}`.toLowerCase().includes(query.toLowerCase())), [games, query])
  const activeDownloads = Object.values(downloads).filter((download) => download.state === 'downloading' || download.state === 'paused')
  const applyDefaultFolder = async () => {
    const desiredFolder = settings.defaultFolder || folder
    if (desiredFolder) return desiredFolder
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
      setNotice('Limpieza temporal completada.')
    }
  }
  const downloadGame = async (game: Game) => {
    const destination = folder || settings.defaultFolder || await applyDefaultFolder()
    if (!destination) {
      setNotice('Selecciona una carpeta para instalar el juego.')
      return
    }
    setFolder(destination); setSelectedGame(null); setView('downloads')
    setDownloads((items) => ({ ...items, [game.id]: { id: game.id, progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0, state: 'downloading', logs: [`Instalar juego: ${game.name}`, 'Preparando descarga...'] } }))
    setNotice(`Preparando el torrent de ${game.name}...`)
    setNotice(`Instalando ${game.name} en ${destination}...`)
    const result = await window.launcher.startDownload({ id: game.id, torrentPath: game.torrentPath, destination })
    if (!result.ok) setNotice(result.message || 'No se pudo iniciar la descarga.')
  }
  const pauseDownload = async (id: string) => {
    await window.launcher.pauseDownload(id)
    setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'paused' } }))
  }
  const resumeDownload = async (id: string) => {
    await window.launcher.resumeDownload(id)
    setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'downloading' } }))
  }
  const cancelDownload = async (id: string) => { await window.launcher.cancelDownload(id); setDownloads((items) => ({ ...items, [id]: { ...items[id], state: 'cancelled' } })) }
  const deleteDownload = async (id: string) => {
    await window.launcher.deleteDownload(id)
    setDownloads((items) => {
      const next = { ...items }
      delete next[id]
      return next
    })
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

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Gamepad2 size={20} /></div><span>LITTLE<span>GODS</span></span></div>
      <nav>
        <button className={view === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setView('library')}><Library size={18} /> {t.nav.library} <span>{games.length}</span></button>
        <button className={view === 'downloads' ? 'nav-item active' : 'nav-item'} onClick={() => setView('downloads')}><ArrowDownToLine size={18} /> {t.nav.downloads} <span>{activeDownloads.length || ''}</span></button>
      </nav>
      <div className="sidebar-bottom"><button className="nav-item muted" onClick={() => setShowSettings(true)}><Settings2 size={18} /> {t.nav.preferences}</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="section-kicker">LITTLEGODS GAMES / OFFICIAL</div><h1>{view === 'library' ? 'Tu biblioteca' : 'Cola de descargas'}</h1></div><div className="top-actions"><div className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar juegos..." /></div><button className="icon-button" title="Actualizar biblioteca" onClick={() => window.launcher.listGames().then(setGames)}><RefreshCw size={17} /></button></div></header>
      {notice && <div className="notice"><Sparkles size={16} />{notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
      {view === 'library' ? <>
        <section className="hero-card"><div className="hero-copy"><div className="hero-tag"><Sparkles size={14} /> {t.hero.catalog}</div><h2>{t.hero.title}</h2><p>{t.hero.description}</p><button className="hero-button" onClick={() => setView('downloads')}>{t.hero.button} <ArrowDownToLine size={16} /></button></div><div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><Gamepad2 size={86} strokeWidth={1.1} /></div></section>
        <div className="section-heading"><div><h2>Todos tus juegos</h2><p>{games.length ? `${games.length} títulos en tu biblioteca` : 'Añade tu primer juego para empezar'}</p></div><div className="library-meta"><ShieldCheck size={16} /> Descarga directa y local</div></div>
        {filteredGames.length ? <div className="game-grid">{filteredGames.map((game) => <article className="game-card" key={game.id} onClick={() => setSelectedGame(game)}><div className="game-cover"><img className="game-banner" src={game.bannerUrl} alt={`Banner ${game.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} /><Gamepad2 className="cover-fallback" size={34} /><span>{game.genre}</span></div><div className="game-info"><div><h3>{game.name}</h3><p>{game.description}</p></div><button className="download-button" onClick={(event) => { event.stopPropagation(); downloadGame(game) }}><ArrowDownToLine size={16} /></button></div></article>)}</div> : <div className="empty-state"><Boxes size={34} /><h3>No hay juegos oficiales disponibles</h3><p>Actualiza la biblioteca para volver a leer el manifiesto remoto.</p></div>}
      </> : <section className="downloads-view"><div className="download-head"><div><h2>Instalaciones</h2>{folder && <p className="install-path">Carpeta actual: {folder}</p>}</div></div>{Object.values(downloads).length ? Object.values(downloads).map((download) => { const game = games.find((item) => item.id === download.id); return <div className="download-row" key={download.id}><div className="mini-cover"><Gamepad2 size={20} /></div><div className="download-main"><div className="download-title"><strong>{game?.name || 'Juego'}</strong><span>{download.state === 'downloading' ? `${Math.round(download.progress * 100)}%` : download.state}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(download.progress * 100, 1)}%` }} /></div><div className="download-stats"><span>{formatSpeed(download.speed)}</span><span>{download.peers} pares</span><span>{formatBytes(download.downloaded)} descargados</span></div><div className="torrent-log">{download.logs.map((log, index) => <div key={`${download.id}-${index}`}>{log}</div>)}</div></div><div className="download-actions"><button className="pause-button" title={download.state === 'paused' ? 'Reanudar descarga' : 'Pausar descarga'} onClick={() => download.state === 'paused' ? resumeDownload(download.id) : pauseDownload(download.id)}><Pause size={16} /></button><button className="pause-button danger" title="Borrar descarga" onClick={() => deleteDownload(download.id)}>X</button></div></div> }) : <div className="empty-state"><ArrowDownToLine size={34} /><h3>No hay instalaciones activas</h3><p>Los juegos que instales aparecerán aquí.</p></div>}</section>}
    </main>
    {selectedGame && <div className="modal-backdrop" onClick={() => setSelectedGame(null)}><section className="modal detail-modal" onClick={(event) => event.stopPropagation()}><div className="game-cover large"><img className="game-banner" src={selectedGame.bannerUrl} alt="" /><Gamepad2 className="cover-fallback" size={58} /></div><div className="section-kicker">INSTALAR JUEGO COMPLETO</div><h2>{selectedGame.name}</h2><p>{selectedGame.description}</p><button className="hero-button" onClick={() => downloadGame(selectedGame)}>Instalar juego <ArrowDownToLine size={16} /></button></section></div>}
    {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="modal settings-modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><div className="section-kicker">{t.nav.preferences}</div><h2>{t.settings.title}</h2></div><button className="close-button" onClick={() => setShowSettings(false)}><X size={16} /></button></div><div className="settings-list"><label className="settings-row"><span>{t.settings.defaultFolder}</span><div className="settings-actions"><input value={settings.defaultFolder || t.settings.none} readOnly /><button className="secondary-button" onClick={handleFolderSelection}>{t.settings.chooseFolder}</button></div></label><label className="settings-row switch-row"><span>{t.settings.autoResume}</span><input type="checkbox" checked={settings.autoResume} onChange={(event) => toggleSetting('autoResume', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.clearTemp}</span><input type="checkbox" checked={settings.clearTemp} onChange={(event) => toggleSetting('clearTemp', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.notifications}</span><input type="checkbox" checked={settings.notifications} onChange={(event) => toggleSetting('notifications', event.target.checked)} /></label><label className="settings-row switch-row"><span>{t.settings.openFolder}</span><input type="checkbox" checked={settings.openFolder} onChange={(event) => toggleSetting('openFolder', event.target.checked)} /></label></div><div className="modal-foot"><button className="secondary-button" onClick={clearTemporaryFiles}>{t.settings.clearNow}</button><button className="hero-button" onClick={() => setShowSettings(false)}>{t.settings.close}</button></div></section></div>}
  </div>
}

export default App
