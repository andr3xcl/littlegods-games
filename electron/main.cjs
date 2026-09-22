const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')
const { autoUpdater } = require('electron-updater')
let WebTorrent

let mainWindow
let client
const downloads = new Map()
const downloadLocations = new Map()
const torrentHealthMonitors = new Map()
const downloadsStatePath = path.join(app.getPath('userData'), 'downloads-state.json')
const approvedFoldersPath = path.join(app.getPath('userData'), 'approved-folders.json')
const manifestUrl = 'https://files.littlegods.space/manifest_games.txt'
const catalogOrigin = 'https://files.littlegods.space'
const officialGames = [
  { id: 't4', name: 'Plutonium T4', genre: 'Zombies / Multiplayer', description: 'La experiencia T4 completa para tu biblioteca.', torrentFile: 'games/torrent/pluto_t4_full_game.torrent', bannerFile: 'games/banner/t4.png' },
  { id: 't5', name: 'Plutonium T5', genre: 'Zombies / Multiplayer', description: 'La experiencia T5 completa para tu biblioteca.', torrentFile: 'games/torrent/pluto_t5_full_game.torrent', bannerFile: 'games/banner/t5.png' },
  { id: 't6', name: 'Plutonium T6', genre: 'Zombies / Multiplayer', description: 'La experiencia T6 completa para tu biblioteca.', torrentFile: 'games/torrent/pluto_t6_full_game.torrent', bannerFile: 'games/banner/t6.png' },
]

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function normalizeFolder(folder) {
  return path.normalize(path.resolve(folder)).replace(/[\\/]+$/, '').toLowerCase()
}

function readApprovedFolders() {
  try {
    if (!fs.existsSync(approvedFoldersPath)) return []
    const parsed = JSON.parse(fs.readFileSync(approvedFoldersPath, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((folder) => typeof folder === 'string') : []
  } catch {
    return []
  }
}

function approveFolder(folder) {
  const normalized = normalizeFolder(folder)
  const folders = new Set(readApprovedFolders().map(normalizeFolder))
  folders.add(normalized)
  fs.writeFileSync(approvedFoldersPath, JSON.stringify([...folders], null, 2))
}

async function validateDownloadDestination(destination) {
  if (typeof destination !== 'string' || !destination.trim() || destination.includes('\0') || !path.isAbsolute(destination)) {
    throw new Error('La carpeta de destino debe ser una ruta absoluta valida.')
  }

  const resolved = path.resolve(destination)
  const appGames = path.join(app.getPath('userData'), 'games')
  const approved = readApprovedFolders().map(normalizeFolder)
  const allowed = normalizeFolder(resolved) === normalizeFolder(appGames)
    || approved.includes(normalizeFolder(resolved))
  if (!allowed) throw new Error('Solo puedes usar la carpeta de datos de Littlegods o una carpeta elegida por ti.')

  const stats = await fs.promises.stat(resolved).catch(() => null)
  if (!stats?.isDirectory()) throw new Error('La carpeta seleccionada ya no existe o no es valida.')
  return resolved
}

function manifestEntries(manifest) {
  return String(manifest).split(/\r?\n/).map((entry) => entry.trim().replace(/^\/+/, '').replace(/\/+$/, '')).filter(Boolean)
}

function isManifestPathListed(manifest, relativePath) {
  const normalizedPath = relativePath.replace(/^\/+/, '').replace(/\/+$/, '')
  return manifestEntries(manifest).some((entry) => entry === normalizedPath || entry.endsWith(`/${normalizedPath}`))
}

async function getManifestGame(id, torrentUrl) {
  const game = officialGames.find((item) => item.id === id)
  if (!game) throw new Error('Este juego no pertenece al catálogo oficial.')

  let parsedUrl
  try {
    parsedUrl = new URL(torrentUrl)
  } catch {
    throw new Error('La ruta del torrent no es valida.')
  }
  if (parsedUrl.origin !== catalogOrigin || parsedUrl.pathname.replace(/^\/+/, '') !== game.torrentFile) {
    throw new Error('La ruta del torrent no coincide con la ruta oficial del proyecto.')
  }

  const response = await fetch(manifestUrl)
  if (!response.ok) throw new Error(`No se pudo verificar el manifest (${response.status}).`)
  const manifest = await response.text()
  if (!isManifestPathListed(manifest, game.torrentFile)) {
    throw new Error('Este juego no esta habilitado en el manifest oficial.')
  }
  return game
}

function configureAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }))
  autoUpdater.on('update-available', (info) => send('update:status', { state: 'available', version: info.version }))
  autoUpdater.on('download-progress', (info) => send('update:status', { state: 'downloading', percent: info.percent }))
  autoUpdater.on('update-downloaded', (info) => send('update:status', { state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => send('update:status', { state: 'error', message: error.message }))
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    if (!error.message.includes('No published versions')) console.warn('No se pudo comprobar si hay actualizaciones:', error.message)
  })
}

async function downloadTorrentFile(id, torrentUrl) {
  const parsedUrl = new URL(torrentUrl)
  if (parsedUrl.origin !== catalogOrigin || !officialGames.some((game) => new URL(game.torrentFile, catalogOrigin).toString() === parsedUrl.toString())) {
    throw new Error('El archivo .torrent no pertenece al catálogo oficial.')
  }
  send('torrent:log', { id, message: 'Descargando archivo .torrent desde el catálogo oficial...' })
  const response = await fetch(torrentUrl)
  if (!response.ok) throw new Error(`No se pudo descargar el torrent (${response.status}).`)
  const folder = path.join(app.getPath('userData'), 'torrents')
  await fs.promises.mkdir(folder, { recursive: true })
  const torrentPath = path.join(folder, `${id}.torrent`)
  const file = Buffer.from(await response.arrayBuffer())
  await fs.promises.writeFile(torrentPath, file)
  send('torrent:log', { id, message: `Torrent guardado localmente: ${torrentPath}` })
  return torrentPath
}

function readDownloadState() {
  try {
    if (!fs.existsSync(downloadsStatePath)) return []
    const raw = fs.readFileSync(downloadsStatePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeDownloadState(entries) {
  fs.writeFileSync(downloadsStatePath, JSON.stringify(entries, null, 2))
}

function updateDownloadState(id, entry) {
  const entries = readDownloadState()
  const index = entries.findIndex((item) => item.id === id)
  if (index >= 0) entries[index] = { ...entries[index], ...entry }
  else entries.push({ ...entry, id })
  writeDownloadState(entries)
}

function removeDownloadState(id) {
  const entries = readDownloadState().filter((item) => item.id !== id)
  writeDownloadState(entries)
}

function cleanupTorrentFile(id) {
  const torrentPath = path.join(app.getPath('userData'), 'torrents', `${id}.torrent`)
  fs.promises.unlink(torrentPath).catch(() => {})
}

function getTorrentControlPath(id) {
  return path.join(app.getPath('userData'), 'torrent-controls', `${id}.pause`)
}

function getDefaultGamesPath() {
  return process.platform === 'win32' ? path.join('C:', 'games') : path.join(app.getPath('userData'), 'games')
}

function canDeleteGameDestination(destination, id) {
  if (!destination || !id) return false
  return path.basename(path.resolve(destination)).toLowerCase() === String(id).toLowerCase()
}

async function clearTorrentPause(id) {
  await fs.promises.unlink(getTorrentControlPath(id)).catch(() => {})
}

function stopTorrentHealthMonitor(id) {
  const stop = torrentHealthMonitors.get(id)
  if (stop) {
    stop()
    torrentHealthMonitors.delete(id)
  }
}

function findPythonExecutable() {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const candidates = [
    path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(projectRoot, '.venv', 'python.exe'),
    'py',
    'python',
    'python3',
  ]

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue

    const result = spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!result.error && result.status === 0) {
      return candidate
    }
  }

  return null
}

function parseProgressLine(line) {
  const trimmed = String(line).trim()
  if (!trimmed) return null
  const nativeProgressMatch = trimmed.match(/^__PROGRESS__:\s*([0-9.]+):([0-9.]+):(\d+):(\d+):(\d+)$/)
  if (nativeProgressMatch) {
    const [, progress, speed, downloaded, total, peers] = nativeProgressMatch
    return { progress: Number(progress) / 100, speed: Number(speed) * 1024, downloaded: Number(downloaded), total: Number(total), peers: Number(peers) }
  }
  const progressMatch = trimmed.match(/Progreso:\s*([0-9.]+)%\s*\|\s*Velocidad:\s*([0-9.]+)\s*KiB\/s\s*\|\s*Descargado:\s*(\d+)\s*B\s*\|\s*Total:\s*(\d+)\s*B\s*\|\s*Pares:\s*(\d+)/i)
  if (progressMatch) {
    const [, progress, speed, downloaded, total, peers] = progressMatch
    return { progress: Number(progress) / 100, speed: Number(speed) * 1024, downloaded: Number(downloaded), total: Number(total), peers: Number(peers) }
  }
  return null
}

function startNativeTorrentDownload(id, torrentPath, destination) {
  const pythonExec = findPythonExecutable()
  if (!pythonExec) {
    throw new Error('No se encontro Python para iniciar la descarga nativa.')
  }

  const rootDir = path.resolve(__dirname, '..', '..')
  const script = [
    'import json, sys, os, traceback',
    `root = ${JSON.stringify(rootDir)}`,
    'if root not in sys.path: sys.path.insert(0, root)',
    'try:',
    '    from src.torrent_service import add_torrent',
    '    def emit(message):',
    '        print(message, flush=True)',
    '    result = add_torrent(sys.argv[1], sys.argv[2], emit, None, sys.argv[3])',
    '    print(f"__RESULT__:{result.code}:{result.output}", flush=True)',
    'except Exception as exc:',
    '    traceback.print_exc(file=sys.stdout)',
    '    print(f"__RESULT__:1:{exc}", flush=True)',
  ].join('\n')

  const child = spawn(pythonExec, ['-c', script, torrentPath, destination, getTorrentControlPath(id)], {
    cwd: rootDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child.on('error', (error) => {
    downloads.delete(id)
    send('torrent:error', { id, message: `No se pudo iniciar Python: ${error.message}` })
    send('torrent:log', { id, message: `Error iniciando el motor nativo: ${error.message}` })
  })

  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      const parsed = parseProgressLine(line)
      if (parsed) {
        send('torrent:progress', { id, ...parsed })
        continue
      }
      if (line.includes('__RESULT__')) {
        const match = line.match(/__RESULT__:(\d+):(.+)/)
        if (match) {
          const [, code, output] = match
          const intCode = Number(code)
          if (intCode === 0) {
            downloadLocations.set(id, destination)
            send('torrent:done', { id, path: destination })
            downloads.delete(id)
          } else {
            send('torrent:error', { id, message: output })
            downloads.delete(id)
          }
          child.kill('SIGTERM')
          return
        }
      }
      if (line && !line.startsWith('__RESULT__')) {
        send('torrent:log', { id, message: line })
      }
    }
  })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) send('torrent:log', { id, message: line.trim() })
    }
  })

  child.on('exit', (code) => {
    if (code !== 0 && !downloads.has(id)) return
    if (downloads.has(id)) {
      const item = downloads.get(id)
      if (item && item.kind === 'native') {
        if (!item.completed) {
          send('torrent:error', { id, message: 'La descarga nativa termino sin completar.' })
        }
      }
      downloads.delete(id)
    }
  })

  return child
}

function startTorrentHealthMonitor(id, torrent) {
  const timer = setInterval(() => {
    if (torrent.destroyed) {
      clearInterval(timer)
      return
    }
  }, 15000)

  torrentHealthMonitors.set(id, () => clearInterval(timer))

  return () => clearInterval(timer)
}

function attachTorrentHandlers(id, torrent, { isRestore = false } = {}) {
  let lastProgressSentAt = 0
  let peerLogSent = false

  torrent.on('metadata', () => send('torrent:log', { id, message: 'Metadatos recibidos. Preparando todos los archivos del juego...' }))
  torrent.on('wire', () => {
    const peerCount = torrent.numPeers || 0
    if (!peerLogSent && peerCount > 0) {
      peerLogSent = true
      send('torrent:log', { id, message: `Conexión P2P establecida. Pares activos: ${peerCount}` })
    }
  })
  torrent.on('download', () => {
    updateDownloadState(id, { id, torrentPath: torrent.torrentFile || path.join(app.getPath('userData'), 'torrents', `${id}.torrent`), destination: torrent.path, name: torrent.name || id })
    const now = Date.now()
    if (now - lastProgressSentAt >= 1200) {
      lastProgressSentAt = now
      send('torrent:progress', { id, progress: torrent.progress, speed: torrent.downloadSpeed, peers: torrent.numPeers, downloaded: torrent.downloaded, total: torrent.length })
    }
  })
  torrent.on('done', () => {
    stopTorrentHealthMonitor(id)
    send('torrent:log', { id, message: 'Todos los archivos del juego se descargaron correctamente.' })
    send('torrent:done', { id, path: torrent.path })
    removeDownloadState(id)
    downloads.delete(id)
  })
  torrent.on('error', (error) => {
    cleanupTorrentFile(id)
    stopTorrentHealthMonitor(id)
    send('torrent:log', { id, message: `Error durante la descarga: ${error.message}` })
    send('torrent:error', { id, message: error.message })
    removeDownloadState(id)
    downloads.delete(id)
  })

  if (isRestore) {
    send('torrent:log', { id, message: `Descarga reanudada desde ${torrent.path}` })
  }
}

async function restorePersistedDownloads() {
  try {
    const entries = readDownloadState()
    if (!entries.length) return

    for (const entry of entries) {
      if (!entry?.id || !entry?.torrentPath || !entry?.destination) continue
      const torrentPath = entry.torrentPath
      if (!fs.existsSync(torrentPath)) continue

      send('torrent:log', { id: entry.id, message: `Reanudando descarga nativa desde ${entry.destination}` })
      if (entry.paused) {
        await fs.promises.mkdir(path.dirname(getTorrentControlPath(entry.id)), { recursive: true })
        await fs.promises.writeFile(getTorrentControlPath(entry.id), 'pause')
      } else {
        await clearTorrentPause(entry.id)
      }
      const process = startNativeTorrentDownload(entry.id, torrentPath, entry.destination)
      downloads.set(entry.id, { kind: 'native', process, path: entry.destination, completed: false, paused: Boolean(entry.paused) })
      downloadLocations.set(entry.id, entry.destination)
      send('torrent:prepared', { id: entry.id, destination: entry.destination })
      send('torrent:progress', { id: entry.id, progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0 })
    }
  } catch (error) {
    console.error('Error restoring active downloads:', error)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#0b0f16',
    title: 'Littlegods Games',
    icon: path.join(__dirname, '..', 'public', 'imagen', 'littlegods.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else mainWindow.loadFile(path.join(__dirname, '..', 'build', 'renderer', 'index.html'))
}

function registerIpc() {
  ipcMain.handle('games:list', async () => {
    const response = await fetch(manifestUrl)
    if (!response.ok) throw new Error(`No se pudo leer el manifest (${response.status}).`)
    const manifest = await response.text()
    return officialGames
      .filter((game) => isManifestPathListed(manifest, game.torrentFile))
      .map((game) => ({ ...game, torrentPath: new URL(game.torrentFile, catalogOrigin).toString(), bannerUrl: new URL(game.bannerFile, catalogOrigin).toString() }))
  })
  ipcMain.handle('torrent:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar torrent',
      properties: ['openFile'],
      filters: [{ name: 'Torrent', extensions: ['torrent'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('folder:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Carpeta de juegos', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled) return null
    approveFolder(result.filePaths[0])
    return result.filePaths[0]
  })
  ipcMain.handle('folder:default', async () => {
    const defaultPath = getDefaultGamesPath()
    await fs.promises.mkdir(defaultPath, { recursive: true })
    approveFolder(defaultPath)
    return defaultPath
  })
  ipcMain.handle('folder:open', async (_event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') return false
    const error = await shell.openPath(folderPath)
    return !error
  })
  ipcMain.handle('folder:exists', async (_event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) return false
    const stats = await fs.promises.stat(folderPath).catch(() => null)
    return Boolean(stats?.isDirectory())
  })
  ipcMain.handle('torrent:start', async (_event, { id, torrentPath, destination }) => {
    let baseDestination
    try {
      const requestedDestination = destination || getDefaultGamesPath()
      if (!destination) await fs.promises.mkdir(requestedDestination, { recursive: true })
      baseDestination = await validateDownloadDestination(requestedDestination)
      await getManifestGame(id, torrentPath)
    } catch (error) {
      const message = error.message || 'La descarga fue bloqueada por seguridad.'
      send('torrent:error', { id, message })
      return { ok: false, message }
    }

    const gameDestination = baseDestination
    const existingGamePath = await fs.promises.lstat(gameDestination).catch(() => null)
    if (existingGamePath?.isSymbolicLink()) {
      const message = 'La carpeta del juego no puede ser un enlace o una ruta redirigida.'
      send('torrent:error', { id, message })
      return { ok: false, message }
    }
    const localTorrentPath = await downloadTorrentFile(id, torrentPath).catch((error) => ({ error }))
    if (localTorrentPath.error) {
      send('torrent:error', { id, message: localTorrentPath.error.message })
      return { ok: false, message: localTorrentPath.error.message }
    }

    const existing = downloads.get(id)
    if (existing) return { ok: false, message: 'Esta descarga ya esta activa.' }

    send('torrent:prepared', { id, destination: gameDestination })
    send('torrent:log', { id, message: 'Iniciando descarga nativa con libtorrent...' })

    try {
      await clearTorrentPause(id)
      const child = startNativeTorrentDownload(id, localTorrentPath, gameDestination)
      downloads.set(id, { kind: 'native', process: child, path: gameDestination, completed: false, paused: false })
      downloadLocations.set(id, gameDestination)
      send('torrent:log', { id, message: `Descarga nativa iniciada en: ${gameDestination}` })
      send('torrent:progress', { id, progress: 0, speed: 0, peers: 0, downloaded: 0, total: 0 })
      return { ok: true }
    } catch (error) {
      const message = `No se pudo iniciar la descarga nativa: ${error.message}`
      send('torrent:error', { id, message })
      send('torrent:log', { id, message })
      return { ok: false, message }
    }
  })
  ipcMain.handle('torrent:pause', async (_event, id) => {
    const item = downloads.get(id)
    if (!item || !item.process) return false
    await fs.promises.mkdir(path.dirname(getTorrentControlPath(id)), { recursive: true })
    await fs.promises.writeFile(getTorrentControlPath(id), 'pause')
    item.paused = true
    updateDownloadState(id, { paused: true })
    send('torrent:paused', { id })
    return true
  })
  ipcMain.handle('torrent:resume', async (_event, id) => {
    const item = downloads.get(id)
    if (!item || !item.process) return false
    await clearTorrentPause(id)
    item.paused = false
    updateDownloadState(id, { paused: false })
    send('torrent:resumed', { id })
    return true
  })
  ipcMain.handle('torrent:cancel', async (_event, id) => {
    const item = downloads.get(id)
    if (!item) return false
    stopTorrentHealthMonitor(id)
    removeDownloadState(id)
    await clearTorrentPause(id)
    if (item.process) item.process.kill('SIGTERM')
    downloads.delete(id)
    send('torrent:cancelled', { id })
    return true
  })
  ipcMain.handle('torrent:delete', async (_event, id) => {
    const item = downloads.get(id)
    const savedEntry = readDownloadState().find((entry) => entry.id === id)
    const destination = item?.path || downloadLocations.get(id) || savedEntry?.destination
    if (item) {
      stopTorrentHealthMonitor(id)
      if (item.process) item.process.kill('SIGTERM')
      downloads.delete(id)
    }
    downloadLocations.delete(id)
    try {
      await clearTorrentPause(id)
      const torrentPath = path.join(app.getPath('userData'), 'torrents', `${id}.torrent`)
      await fs.promises.unlink(torrentPath).catch(() => {})
      if (canDeleteGameDestination(destination, id)) {
        await fs.promises.rm(destination, { recursive: true, force: true })
      } else if (destination) {
        console.warn(`Se conserva la carpeta padre; ruta no eliminada para ${id}: ${destination}`)
      }
    } catch (error) {
      console.error('Failed deleting torrent download', error)
    }
    removeDownloadState(id)
    send('torrent:cancelled', { id })
    return true
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  configureAutoUpdater()
  restorePersistedDownloads()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  const entries = [...downloads.entries()].map(([id, torrent]) => ({ id, torrentPath: torrent.torrentFile || path.join(app.getPath('userData'), 'torrents', `${id}.torrent`), destination: torrent.path || path.join(app.getPath('userData'), 'games'), name: torrent.name || id, paused: Boolean(torrent.paused) }))
  writeDownloadState(entries)
  if (client) client.destroy()
})
