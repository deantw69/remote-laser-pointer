// Windows 低階滑鼠 hook(WH_MOUSE_LL):指點期間「吞掉」左鍵按/放/雙擊,
// 讓點擊不會穿到下層 app;滑鼠移動照放行(游標仍會動、雷射點正常)。
// 用 FFI(koffi)實作,免編譯原生模組;非 win32 平台全為 no-op。
//
// 搭配 uiohook 的順序:startPointing 先 install 本 hook、再 start uiohook,
// 使 uiohook 的 hook 較晚安裝→較早被呼叫(先讀到事件驅動手勢),
// 本 hook 較早安裝→較晚被呼叫,回傳 1 阻止事件遞送到下層 app。

const WH_MOUSE_LL = 14
const WM_LBUTTONDOWN = 0x0201
const WM_LBUTTONUP = 0x0202
const WM_LBUTTONDBLCLK = 0x0203

let hook: unknown = null
let callback: unknown = null
let suppress = false

// 延遲載入 koffi 並綁定 Win32 API;失敗(平台不符/載入錯)則回傳 null 表示不可用
type Native = {
  SetWindowsHookExW: (id: number, fn: unknown, mod: unknown, tid: number) => unknown
  CallNextHookEx: (hhk: unknown, n: number, w: number, l: number) => number
  UnhookWindowsHookEx: (hhk: unknown) => boolean
  GetModuleHandleW: (name: unknown) => unknown
  register: (fn: (n: number, w: number, l: number) => number, type: unknown) => unknown
  unregister: (cb: unknown) => void
  procPtrType: unknown
}
let native: Native | null | undefined

function loadNative(): Native | null {
  if (native !== undefined) return native
  if (process.platform !== 'win32') {
    native = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const proc = koffi.proto('intptr_t __stdcall LowLevelMouseProc(int nCode, uintptr_t wParam, uintptr_t lParam)')
    native = {
      SetWindowsHookExW: user32.func(
        'void* __stdcall SetWindowsHookExW(int idHook, LowLevelMouseProc* lpfn, void* hMod, uint32_t dwThreadId)'
      ),
      CallNextHookEx: user32.func(
        'intptr_t __stdcall CallNextHookEx(void* hhk, int nCode, uintptr_t wParam, uintptr_t lParam)'
      ),
      UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(void* hhk)'),
      GetModuleHandleW: kernel32.func('void* __stdcall GetModuleHandleW(str16 lpModuleName)'),
      register: koffi.register,
      unregister: koffi.unregister,
      procPtrType: koffi.pointer(proc)
    }
    return native
  } catch {
    native = null
    return null
  }
}

export function installClickSuppressor(): void {
  if (hook) return
  const n = loadNative()
  if (!n) return
  try {
    callback = n.register((nCode: number, wParam: number, lParam: number): number => {
      if (nCode >= 0 && suppress && (wParam === WM_LBUTTONDOWN || wParam === WM_LBUTTONUP || wParam === WM_LBUTTONDBLCLK)) {
        return 1 // 吞掉左鍵事件,不遞送到下層
      }
      return n.CallNextHookEx(null, nCode, wParam, lParam)
    }, n.procPtrType)
    hook = n.SetWindowsHookExW(WH_MOUSE_LL, callback, n.GetModuleHandleW(null), 0)
  } catch {
    hook = null
    callback = null
  }
}

export function uninstallClickSuppressor(): void {
  const n = native
  if (n && hook) {
    try {
      n.UnhookWindowsHookEx(hook)
    } catch {
      // ignore
    }
  }
  if (n && callback) {
    try {
      n.unregister(callback)
    } catch {
      // ignore
    }
  }
  hook = null
  callback = null
  suppress = false
}

export function setSuppress(on: boolean): void {
  suppress = on
}
