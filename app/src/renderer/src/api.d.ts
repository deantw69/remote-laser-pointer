export {}

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<any>
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, cb: (...args: any[]) => void) => () => void
    }
  }
}
