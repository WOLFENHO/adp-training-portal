import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
const server = createServer(async (req, res) => {
  const path = req.url === '/player-lifecycle.mjs'
    ? resolve(root, 'src/lib/player-lifecycle.mjs')
    : req.url === '/' ? resolve(root, 'supabase/tests/player_lifecycle.browser.html') : null
  if (!path) { res.writeHead(404); res.end('not found'); return }
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': path.endsWith('.mjs') ? 'text/javascript' : 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch { res.writeHead(500); res.end('test fixture unavailable') }
})
server.listen(4177, '127.0.0.1', () => console.log('Player lifecycle browser test on http://127.0.0.1:4177'))
