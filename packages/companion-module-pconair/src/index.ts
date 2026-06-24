import {
  InstanceBase,
  runEntrypoint,
  InstanceStatus,
  type SomeCompanionConfigField,
} from '@companion-module/base'
import { PcoClient, type PcoState } from './client.js'
import { VARIABLE_DEFINITIONS, stateToVariables } from './variables.js'
import { buildActions } from './actions.js'
import { buildFeedbacks } from './feedbacks.js'
import { buildPresets } from './presets.js'
import { buildPackageDefinitions, parsePackageList, type PackageInfo } from './packages.js'
import type { PkgState } from './pkg-engine.js'
import upgradeScripts from './upgrades.js'

export interface Config {
  host: string
  port: number
  operator_pin: string
  polling_interval_ms: number
}

const PACKAGE_REFRESH_MS = 30_000

class PcOnAirInstance extends InstanceBase<Config> {
  private client: PcoClient | null = null
  private connected = false
  private state: Partial<PcoState> = {}
  private pkgStates = new Map<string, PkgState>()
  private packages: PackageInfo[] = []
  private packagesSnapshot = ''
  private pkgDefs: ReturnType<typeof buildPackageDefinitions> | null = null
  private pkgRefreshTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null

  async init(config: Config): Promise<void> {
    this.registerDefinitions()
    this.updateStatus(InstanceStatus.Connecting)
    this.setVariableValues({ connection_status: 'connecting', connected: '0' })
    this.startClient(config)
    this.pkgRefreshTimer = setInterval(() => {
      void this.refreshPackages()
    }, PACKAGE_REFRESH_MS)
    // 1 s display tick for running package countdowns (game clocks, timers).
    this.tickTimer = setInterval(() => {
      if (this.pkgDefs?.needsTick()) {
        this.setVariableValues(this.pkgDefs.computeVariableValues())
      }
    }, 1000)
  }

  async destroy(): Promise<void> {
    if (this.pkgRefreshTimer) clearInterval(this.pkgRefreshTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.pkgRefreshTimer = null
    this.tickTimer = null
    this.client?.destroy()
    this.client = null
  }

  async configUpdated(config: Config): Promise<void> {
    this.client?.destroy()
    this.client = null
    this.connected = false
    this.updateStatus(InstanceStatus.Connecting)
    this.setVariableValues({ connection_status: 'connecting', connected: '0' })
    this.startClient(config)
  }

  getConfigFields(): SomeCompanionConfigField[] {
    return [
      {
        type: 'static-text',
        id: 'info',
        width: 12,
        label: 'Information',
        value:
          'Controls PConAir over the LAN (WebSocket + HTTP). The PConAir machine must allow this host in its IP allowlist.',
      },
      {
        type: 'textinput',
        id: 'host',
        label: 'Host',
        default: '127.0.0.1',
        width: 8,
        tooltip: 'IP address or hostname of the PConAir machine',
      },
      {
        type: 'number',
        id: 'port',
        label: 'Port',
        default: 8080,
        min: 1,
        max: 65535,
        width: 4,
        tooltip: 'PConAir server port (Settings → Network; default 8080)',
      },
      {
        type: 'textinput',
        id: 'operator_pin',
        label: 'Operator PIN (optional)',
        default: '',
        width: 6,
        tooltip: 'Only needed for the HTTP fallback when the WebSocket is unavailable',
      },
      {
        type: 'number',
        id: 'polling_interval_ms',
        label: 'HTTP Polling Interval (ms)',
        default: 1000,
        min: 250,
        max: 30000,
        width: 6,
        tooltip: 'Fallback polling interval if the WebSocket is unavailable',
      },
    ]
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  private registerDefinitions(): void {
    this.pkgDefs = buildPackageDefinitions(this.packages, {
      getPkgState: (id) => this.pkgStates.get(id) ?? {},
      patchPkg: async (id, patch) => {
        if (!this.client) throw new Error('not connected')
        await this.client.patchPackageState(id, patch)
      },
      log: (level, msg) => this.log(level, msg),
    })

    this.setActionDefinitions({
      ...buildActions({
        dispatch: this.sendAction.bind(this),
        gscPost: async (path, body) => {
          if (!this.client) throw new Error('not connected')
          return this.client.httpPost(path, body)
        },
        getApp: () => this.state,
        log: (level, msg) => this.log(level, msg),
      }),
      ...this.pkgDefs.actions,
    })
    this.setFeedbackDefinitions({
      ...buildFeedbacks(
        () => this.state,
        () => this.connected
      ),
      ...this.pkgDefs.feedbacks,
    })
    this.setVariableDefinitions([...VARIABLE_DEFINITIONS, ...this.pkgDefs.variableDefs])
    this.setPresetDefinitions(buildPresets())
    this.pushAllVariables()
  }

  private startClient(config: Config): void {
    this.client = new PcoClient({
      host: config.host || '127.0.0.1',
      port: config.port || 8080,
      operatorPin: config.operator_pin || '',
      pollingIntervalMs: Math.max(250, config.polling_interval_ms || 1000),
      onAppState: (patch, replace) => {
        this.state = replace ? patch : { ...this.state, ...patch }
        this.pushAllVariables()
        this.checkFeedbacks()
      },
      onPackageState: (pkgId, state) => {
        this.pkgStates.set(pkgId, state)
        if (this.pkgDefs) this.setVariableValues(this.pkgDefs.computeVariableValues())
        this.checkFeedbacks()
      },
      onConnectionChange: (connected) => {
        if (connected === this.connected) return
        this.connected = connected
        this.updateStatus(connected ? InstanceStatus.Ok : InstanceStatus.ConnectionFailure)
        this.pushAllVariables()
        this.checkFeedbacks()
        if (connected) void this.refreshPackages()
      },
      log: (level, msg) => this.log(level, msg),
    })
    this.client.start()
  }

  /**
   * Load the package list (with declarative Companion interfaces) and
   * re-register definitions when it changed — packages dropped into PConAir
   * become controllable without restarting Companion.
   */
  private async refreshPackages(): Promise<void> {
    if (!this.client || !this.connected) return
    try {
      const body = await this.client.httpGet('/api/packages')
      const packages = parsePackageList(body)
      const snapshot = JSON.stringify(packages)
      this.client.setPackageSubscriptions(packages.map((p) => p.id))
      if (snapshot === this.packagesSnapshot) return
      this.packagesSnapshot = snapshot
      this.packages = packages
      for (const id of Array.from(this.pkgStates.keys())) {
        if (!packages.some((p) => p.id === id)) this.pkgStates.delete(id)
      }
      this.registerDefinitions()
      this.log('info', `Loaded ${packages.length} package interface(s): ${packages.map((p) => p.id).join(', ') || '(none)'}`)
    } catch (err) {
      this.log('debug', `Package refresh failed: ${(err as Error).message}`)
    }
  }

  private pushAllVariables(): void {
    this.setVariableValues({
      ...stateToVariables(this.state, this.connected),
      ...(this.pkgDefs ? this.pkgDefs.computeVariableValues() : {}),
    })
  }

  private async sendAction(actionId: string, params: Record<string, unknown>): Promise<void> {
    if (!this.client) {
      this.log('warn', 'Action triggered but client not initialised')
      return
    }
    await this.client.sendAction(actionId, params)
  }
}

runEntrypoint(PcOnAirInstance, upgradeScripts)
