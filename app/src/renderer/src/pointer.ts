import type { Mark } from '../../shared/protocol'
import { MarkCanvas } from './marks'

// 指點窗為點擊穿透:不收 DOM 滑鼠,改由 main 的全域 hook 讀滑鼠、算好 Mark 後推回顯。
// 手勢(移動=雷射、點=圈圈、拖=畫線)與結束(Esc/F8)都在 main 處理。
const mc = new MarkCanvas(document.getElementById('c') as HTMLCanvasElement)

window.api.on('pointer:echo', (m) => mc.add(m as Mark))

const hintEl = document.getElementById('hint')
if (hintEl) hintEl.textContent = `指點模式:點=圈圈|拖=畫線|移動=雷射點|Esc / ${window.api.hotkeyLabel} 結束`
