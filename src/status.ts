/** Status bar item reflecting the DeepSeek Harness server state. */
import * as vscode from 'vscode'
import type { ServerState } from './server'

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.name = 'DeepSeek Harness'
    this.item.command = 'dsh.open'
    this.item.tooltip = 'DeepSeek Harness — click to open the panel'
    this.update('unknown', '')
    this.item.show()
  }

  update(state: ServerState, url: string): void {
    switch (state) {
      case 'online':
        this.item.text = '$(radio-tower) DSH Online'
        this.item.tooltip = `DeepSeek Harness is running at ${url} — click to open the panel`
        this.item.color = new vscode.ThemeColor('charts.green')
        this.item.backgroundColor = undefined
        break
      case 'starting':
        this.item.text = '$(loading~spin) DSH Starting…'
        this.item.tooltip = 'Starting the DeepSeek Harness server…'
        this.item.color = undefined
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
        break
      case 'stopping':
        this.item.text = '$(loading~spin) DSH Stopping…'
        this.item.tooltip = 'Stopping the DeepSeek Harness server…'
        this.item.color = undefined
        this.item.backgroundColor = undefined
        break
      case 'error':
        this.item.text = '$(error) DSH Error'
        this.item.tooltip = 'DeepSeek Harness failed to start — see the output channel'
        this.item.color = new vscode.ThemeColor('charts.red')
        this.item.backgroundColor = undefined
        break
      default:
        this.item.text = '$(circle-slash) DSH Offline'
        this.item.tooltip = 'DeepSeek Harness is not running — click to open the panel'
        this.item.color = undefined
        this.item.backgroundColor = undefined
    }
  }

  dispose(): void {
    this.item.dispose()
  }
}
