import http from 'node:http'
import { Server } from 'socket.io'

const PORT = process.env.PORT || 3000
const EMPTY_ROOM_TTL_MS = 60_000
// 排除易混淆字元(0/O、1/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** @type {Map<string, { members: Set<string>, emptySince: number | null }>} */
const rooms = new Map()

function genCode() {
  let code = ''
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
  } while (rooms.has(code))
  return code
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('remote-laser-pointer relay')
})

const io = new Server(httpServer, { cors: { origin: '*' } })

function leaveCurrent(socket) {
  const code = socket.data.room
  if (!code) return
  socket.data.room = null
  socket.leave(code)
  const room = rooms.get(code)
  if (!room) return
  room.members.delete(socket.id)
  socket.to(code).emit('peer-left')
  if (room.members.size === 0) room.emptySince = Date.now()
}

io.on('connection', (socket) => {
  socket.data.room = null

  socket.on('create-room', (cb) => {
    leaveCurrent(socket)
    const code = genCode()
    rooms.set(code, { members: new Set([socket.id]), emptySince: null })
    socket.join(code)
    socket.data.room = code
    cb?.({ ok: true, code })
  })

  socket.on('join-room', (codeRaw, cb) => {
    const code = String(codeRaw || '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return cb?.({ ok: false, error: 'not-found' })
    if (room.members.size >= 2 && !room.members.has(socket.id)) return cb?.({ ok: false, error: 'full' })
    leaveCurrent(socket)
    room.members.add(socket.id)
    room.emptySince = null
    socket.join(code)
    socket.data.room = code
    socket.to(code).emit('peer-joined')
    cb?.({ ok: true, code, peers: room.members.size - 1 })
  })

  socket.on('leave-room', () => leaveCurrent(socket))

  // 中繼:只轉發給同房間的另一方,不解析內容
  for (const ev of ['pointer', 'meta']) {
    socket.on(ev, (payload) => {
      const code = socket.data.room
      if (code) socket.to(code).emit(ev, payload)
    })
  }

  socket.on('disconnect', () => leaveCurrent(socket))
})

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.members.size === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(code)
    }
  }
}, 30_000)

httpServer.listen(PORT, () => console.log(`relay listening on :${PORT}`))
