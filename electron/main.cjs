const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')
let WebTorrent

let mainWindow
let client
const downloads = new Map()
const downloadLocations = new Map()
const torrentHealthMonitors = new Map()
const downloadsStatePath = path.join(app.getPath('userData'), 'downloads-state.json')
const manifestUrl = 'https://files.littlegods.space/manifest_games.txt'
const officialGames = [
  { id: 't4', name: 'Plutonium T4', genre: 'Zombies / Multiplayer', description: 'La experiencia T4 completa para tu biblioteca.', torrentFile: 'games/torrent/pluto_t4_full_game.torrent', bannerFile: 'games/banner/t4.png' },
  { id: 't5', name: 'Plutonium T5', genre: 'Zombies / Multiplayer', description: 'La experiencia T5 completa para tu biblioteca.', torrentFile: 'games/torrent/pluto_t5_full_game.torrent', bannerFile: 'games/banner/t5.png' },
  { id: 't6', name: 'Plutonium T6', genre: 'Zombies / Multiplayer', description: 'La experiencia T6 completa para tu biblioteca.', torrentFile: 'games/torrent/pluto_t6_full_game.torrent', bannerFile: 'games/banner/t6.png' },
]

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

async function downloadTorrentFile(id, torrentUrl) {
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
  const progressMatch = trimmed.match(/Progreso:\s*([0-9.]+)%\s*\|\s*Velocidad:\s*([0-9.]+)\s*KiB\/s/i)
  if (progressMatch) {
    const [, progress, speed] = progressMatch
    return { progress: Number(progress) / 100, speed: Number(speed) * 1024 }
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
        send('torrent:progress', { id, progress: parsed.progress, speed: parsed.speed, peers: 1, downloaded: Math.max(parsed.progress, 0) * 100, total: 100 })
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
      send('torrent:progress', { id: entry.id, progress: 0, speed: 0, peers: 0, downloaded: 0, total: 100 })
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

function registerIpc() {
  ipcMain.handle('games:list', async () => {
    const manifest = await fetch(manifestUrl).then((response) => response.text())
    return officialGames
      .filter((game) => manifest.includes(game.torrentFile))
      .map((game) => ({ ...game, torrentPath: new URL(game.torrentFile, 'https://files.littlegods.space/').toString(), bannerUrl: new URL(game.bannerFile, 'https://files.littlegods.space/').toString() }))
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
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('torrent:start', async (_event, { id, torrentPath, destination }) => {
    const gameDestination = destination || path.join(app.getPath('userData'), 'games')
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
      send('torrent:progress', { id, progress: 0, speed: 0, peers: 1, downloaded: 0, total: 100 })
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
      if (destination) await fs.promises.rm(destination, { recursive: true, force: true })
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
  restorePersistedDownloads()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  const entries = [...downloads.entries()].map(([id, torrent]) => ({ id, torrentPath: torrent.torrentFile || path.join(app.getPath('userData'), 'torrents', `${id}.torrent`), destination: torrent.path || path.join(app.getPath('userData'), 'games'), name: torrent.name || id, paused: Boolean(torrent.paused) }))
  writeDownloadState(entries)
  if (client) client.destroy()
})
