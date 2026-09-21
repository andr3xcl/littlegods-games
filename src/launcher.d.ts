declare global {
  type Game = {
  id: string
  name: string
  genre: string
  description: string
    torrentPath: string
    bannerUrl: string
  }

  type DownloadProgress = {
  id: string
  progress: number
  speed: number
  peers: number
  downloaded: number
  total: number
  }

  interface Window {
    launcher: {
      listGames: () => Promise<Game[]>
      pickTorrent: () => Promise<string | null>
      pickFolder: () => Promise<string | null>
      startDownload: (payload: { id: string; torrentPath: string; destination: string }) => Promise<{ ok: boolean; message?: string }>
      pauseDownload: (id: string) => Promise<boolean>
      resumeDownload: (id: string) => Promise<boolean>
      cancelDownload: (id: string) => Promise<boolean>
      deleteDownload: (id: string) => Promise<boolean>
      onProgress: (callback: (payload: DownloadProgress) => void) => void
      onLog: (callback: (payload: { id: string; message: string }) => void) => void
      onPrepared: (callback: (payload: { id: string; destination: string }) => void) => void
      onDone: (callback: (payload: { id: string; path: string }) => void) => void
      onError: (callback: (payload: { id: string; message: string }) => void) => void
      onCancelled: (callback: (payload: { id: string }) => void) => void
      onPaused: (callback: (payload: { id: string }) => void) => void
      onResumed: (callback: (payload: { id: string }) => void) => void
    }
  }
}

export {}
