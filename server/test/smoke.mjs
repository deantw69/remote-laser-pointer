import { io } from 'socket.io-client'

const URL = process.env.RELAY_URL || 'http://localhost:3000'
const fail = (msg) => {
  console.error('SMOKE FAIL:', msg)
  process.exit(1)
}
setTimeout(() => fail('timeout'), 10_000)

const once = (sock, ev) => new Promise((res) => sock.once(ev, res))
const ack = (sock, ev, ...args) =>
  new Promise((res, rej) => sock.timeout(5000).emit(ev, ...args, (err, r) => (err ? rej(err) : res(r))))

const a = io(URL)
const b = io(URL)
await Promise.all([once(a, 'connect'), once(b, 'connect')])

const created = await ack(a, 'create-room')
if (!created?.ok || !created.code) fail('create-room')
console.log('room:', created.code)

const peerJoined = once(a, 'peer-joined')
const joined = await ack(b, 'join-room', created.code)
if (!joined?.ok) fail('join-room')
await peerJoined
console.log('peer-joined ok')

const gotAtB = once(b, 'pointer')
a.emit('pointer', { t: 'ping', x: 0.25, y: 0.75 })
const evt = await gotAtB
if (evt?.t !== 'ping' || evt.x !== 0.25 || evt.y !== 0.75) fail('relay pointer a->b')
console.log('pointer relay ok')

const gotMetaAtA = once(a, 'meta')
b.emit('meta', { kind: 'sharer-info', aspect: 16 / 9, width: 1920, height: 1080 })
const meta = await gotMetaAtA
if (meta?.kind !== 'sharer-info' || meta.width !== 1920) fail('relay meta b->a')
console.log('meta relay ok')

const notFound = await ack(b, 'join-room', 'ZZZZZZ')
if (notFound?.ok || notFound?.error !== 'not-found') fail('not-found check')

const c = io(URL)
await once(c, 'connect')
const full = await ack(c, 'join-room', created.code)
if (full?.ok || full?.error !== 'full') fail('full check')
console.log('room limit ok')

const peerLeft = once(a, 'peer-left')
b.disconnect()
await peerLeft
console.log('peer-left ok')

console.log('SMOKE OK')
process.exit(0)
