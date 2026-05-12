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
import upgradeScripts from './upgrades.js'

export interface Config {
  host: string
  port: number
  operator_pin: string
  polling_interval_ms: number
}

class PcOnAirInstance extends InstanceBase<Config> {
  private client: PcoClient | null = null
  private connected = false
  private state: Partial<PcoState> = {}

  async init(config: Config): Promise<void> {
    this.setVariableDefinitions(VARIABLE_DEFINITIONS)
    this.setActionDefinitions(buildActions(this.sendAction.bind(this)))
    this.setFeedbackDefinitions(buildFeedbacks((id) => String(this.getVariableValue(id) ?? '')))
    this.setPresetDefinitions(buildPresets())
    this.updateStatus(InstanceStatus.Connecting)
    this.setVariableValues({ connection_status: 'connecting', connected: '0' })
    this.startClient(config)
  }

  async destroy(): Promise<void> {
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
        type: 'textinput',
        id: 'host',
        label: 'Host',
        default: 'localhost',
        width: 8,
        tooltip: 'IP address or hostname of the PC On Air machine',
      },
      {
        type: 'number',
        id: 'port',
        label: 'Port',
        default: 8080,
        min: 1024,
        max: 65535,
        width: 4,
        tooltip: 'Port number for PC On Air WebSocket/HTTP API',
      },
      {
        type: 'textinput',
        id: 'operator_pin',
        label: 'Operator PIN',
        default: '',
        width: 6,
        tooltip: 'Optional PIN for operator-level authentication',
      },
      {
        type: 'number',
        id: 'polling_interval_ms',
        label: 'HTTP Polling Interval (ms)',
        default: 2000,
        min: 500,
        max: 30000,
        width: 6,
        tooltip: 'Fallback polling interval if WebSocket is unavailable',
      },
    ]
  }

  private startClient(config: Config): void {
    this.client = new PcoClient({
      host: config.host || 'localhost',
      port: config.port || 8080,
      operatorPin: config.operator_pin || '',
      pollingIntervalMs: Math.max(500, config.polling_interval_ms || 2000),
      onStateUpdate: (patch) => {
        this.state = { ...this.state, ...patch }
        this.setVariableValues(stateToVariables(this.state, this.connected))
        this.checkFeedbacks()
      },
      onConnectionChange: (connected) => {
        this.connected = connected
        this.updateStatus(connected ? InstanceStatus.Ok : InstanceStatus.ConnectionFailure)
        this.setVariableValues(stateToVariables(this.state, connected))
        this.checkFeedbacks()
      },
      log: (level, msg) => this.log(level, msg),
    })
    this.client.start()
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
