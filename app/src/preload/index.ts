import { contextBridge, ipcRenderer } from 'electron'

const api = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]): void => {
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, cb: (...args: unknown[]) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  // 指點模式切換鍵的顯示標籤(需與 main 的 TOGGLE_HOTKEY 一致)
  hotkeyLabel: process.platform === 'darwin' ? '⌘⇧L' : 'F8',
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
