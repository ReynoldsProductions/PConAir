import WebSocket from 'ws'

/**
 * Connection layer for the PConAir Companion module.
 *
 * Primary transport: cookie-less WebSocket to /ws?companion=1 (LAN,
 * IP-allowlist-gated server-side — same trust model as the GSC-compat HTTP
 * endpoints). The server pushes the full AppState on connect, state patches on
 * every change, and per-package state for subscribed `package:<id>` namespaces.
 *
 * Fallback: HTTP polling of GET /api/status and per-package state while the
 * WebSocket is down.
 */

// AppState as the module consumes it — a superset-tolerant shape.
export interface SlidesStateLike {
  deckId: string
  deckTitle: string
  slideIndex: number // 0-based
  slideCount: number
  isLoading: boolean
  deckUrl: string | null
  backupDeckUrl: string | null
  backupLoaded: boolean
  notes: string
  notesOpen: boolean
  offlineMode: boolean
  cacheWarmed: boolean
  contentKind: 'slides' | 'url' | 'none'
}

export interface PcoState {
  currentMode: string
  currentUrl: string | null
  currentPreset: { id: string; name: string } | null
  slides: SlidesStateLike | null
  l3: {
    activeCueId: string | null
    activeCueName: string | null
    activeTitle: string | null
    activeTheme: string | null
    isStacking: boolean
    currentPlaylistId: string | null
    playlistPosition: number | null
    playlistLength: number | null
  } | null
  mediaLibrary: {
    activeItemId: string | null
    activeItemName: string | null
    slideshow: {
      running: boolean
      paused: boolean
      itemIds: string[]
      position: number
      intervalSec: number
      transition: 'cut' | 'fade'
    } | null
  } | null
  abState: { activeInstance: 'A' | 'B' }
  connectionStatus: { webSocketClients: number; companionConnected: boolean; adminShowLocked: boolean }
  reliability: { panicActive: boolean }
  tunnel: { enabled: boolean; status: string; url: string | null; pinRequired: boolean; lastError: string | null }
  renderOutputs: Record<string, { bg: string; chromaColor: string; claimedOutput: string | null }>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ClientConfig {
  host: string
  port: number
  /** Only used for the authenticated HTTP fallback (POST /api/action). */
  operatorPin: string
  pollingIntervalMs: number
  onAppState: (state: Partial<PcoState>, replace: boolean) => void
  onPackageState: (pkgId: string, state: Record<string, unknown>) => void
  onConnectionChange: (connected: boolean) => void
  log: (level: LogLevel, msg: string) => void
}

export class PcoClient {
  private config: ClientConfig
  private ws: WebSocket | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectDelay = 1000
  private destroyed = false
  private wsConnected = false
  private packageIds: string[] = []

  constructor(config: ClientConfig) {
    this.config = config
  }

  start(): void {
    this.destroyed = false
    this.connectWs()
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.ws) {
      this.ws.terminate()
      this.ws = null
    }
  }

  get connected(): boolean {
    return this.wsConnected
  }

  /** Subscribe to package state namespaces (resubscribed on every reconnect). */
  setPackageSubscriptions(pkgIds: string[]): void {
    const added = pkgIds.filter((id) => !this.packageIds.includes(id))
    this.packageIds = [...pkgIds]
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      for (const id of added) {
        this.ws.send(JSON.stringify({ type: 'subscribe', namespace: `package:${id}` }))
      }
    }
  }

  /** Dispatch a PConAir action (WebSocket preferred, HTTP /api/action fallback). */
  async sendAction(actionId: string, params: Record<string, unknown>): Promise<void> {
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'action', action_id: actionId, params }))
      return
    }
    try {
      const pinQ = this.config.operatorPin ? `?operator_pin=${encodeURIComponent(this.config.operatorPin)}` : ''
      const res = await fetch(`${this.httpBase()}/api/action${pinQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: actionId, params }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        this.config.log('warn', `Action ${actionId} failed: ${body?.error?.message ?? res.status}`)
      }
    } catch (err) {
      this.config.log('warn', `HTTP action failed: ${String(err)}`)
    }
  }

  /**
   * POST to a cookie-less endpoint (GSC-compat actions, package state patches).
   * Resolves with the parsed body; throws with the server's error message on
   * non-200 (matching the GSC module's behaviour of surfacing response.error).
   */
  async httpPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.httpBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const err = json.error
      const msg =
        typeof err === 'string'
          ? err
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : `HTTP ${res.status}`
      throw new Error(msg)
    }
    return json
  }

  async httpGet(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.httpBase()}${path}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as Record<string, unknown>
  }

  /** Patch a package's state (cookie-less, shared path with control UIs). */
  async patchPackageState(pkgId: string, patch: Record<string, unknown>): Promise<void> {
    await this.httpPost(`/api/packages/${encodeURIComponent(pkgId)}/state`, patch)
  }

  private httpBase(): string {
    return `http://${this.config.host}:${this.config.port}`
  }

  private wsUrl(): string {
    return `ws://${this.config.host}:${this.config.port}/ws?companion=1`
  }

  private connectWs(): void {
    if (this.destroyed) return
    try {
      const ws = new WebSocket(this.wsUrl())
      this.ws = ws

      ws.on('open', () => {
        this.reconnectDelay = 1000
        this.wsConnected = true
        if (this.pollTimer) {
          clearInterval(this.pollTimer)
          this.pollTimer = null
        }
        for (const id of this.packageIds) {
          ws.send(JSON.stringify({ type: 'subscribe', namespace: `package:${id}` }))
        }
        this.config.onConnectionChange(true)
        this.config.log('info', `Connected to PConAir at ${this.config.host}:${this.config.port}`)
      })

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: string
            payload?: unknown
            namespace?: string
            state?: Record<string, unknown>
          }
          if (msg.type === 'state' && typeof msg.namespace === 'string' && msg.state) {
            const m = /^package:(.+)$/.exec(msg.namespace)
            if (m) this.config.onPackageState(m[1], msg.state)
          } else if (msg.type === 'state' && msg.payload) {
            this.config.onAppState(msg.payload as Partial<PcoState>, true)
          } else if (msg.type === 'state_patch' && msg.payload) {
            this.config.onAppState(msg.payload as Partial<PcoState>, false)
          } else if (msg.type === 'error' && msg.payload) {
            this.config.log('debug', `Server error: ${JSON.stringify(msg.payload)}`)
          }
        } catch {
          /* ignore malformed */
        }
      })

      ws.on('close', () => {
        this.wsConnected = false
        this.ws = null
        if (!this.destroyed) {
          this.config.onConnectionChange(false)
          this.config.log('warn', 'WebSocket closed; polling over HTTP until it returns')
          this.startHttpFallback()
          this.scheduleReconnect()
        }
      })

      ws.on('error', (err: Error) => {
        this.config.log('debug', `WebSocket error: ${err.message}`)
        // close fires after error
      })
    } catch (err) {
      this.config.log('error', `Failed to create WebSocket: ${String(err)}`)
      this.startHttpFallback()
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.destroyed && !this.wsConnected) {
        this.connectWs()
      }
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
  }

  private startHttpFallback(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      void this.httpPoll()
    }, this.config.pollingIntervalMs)
    void this.httpPoll()
  }

  private async httpPoll(): Promise<void> {
    if (this.wsConnected) {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
      return
    }
    try {
      const state = await this.httpGet('/api/status')
      this.config.onConnectionChange(true)
      this.config.onAppState(state as Partial<PcoState>, true)
      for (const id of this.packageIds) {
        try {
          const r = await this.httpGet(`/api/packages/${encodeURIComponent(id)}/state`)
          if (r.state) this.config.onPackageState(id, r.state as Record<string, unknown>)
        } catch {
          /* package may be gone; list refresh will catch it */
        }
      }
    } catch {
      this.config.onConnectionChange(false)
    }
  }
}
