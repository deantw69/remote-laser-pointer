import type { Mark } from '../../shared/protocol'
import { MarkCanvas } from './marks'

const mc = new MarkCanvas(document.getElementById('c') as HTMLCanvasElement)
window.api.on('pointer', (m) => mc.add(m as Mark))
