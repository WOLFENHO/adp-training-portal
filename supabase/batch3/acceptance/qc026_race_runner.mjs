// Live, writing acceptance tool. Run only after Gate 2 authorization and fixtures.
// libpq credentials are supplied by a protected process environment; never pass
// passwords or connection strings on a command line or save process output.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ref = 'nqqarmkgnuvvqnvnodyc'
const required = key => {
  if (!process.env[key]) throw Error(`missing protected setting: ${key}`)
  return process.env[key]
}
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ? value : (() => { throw Error('invalid disposable UUID') })()

export function renderRaceSql(template, ids, hold) {
  const replacements = {
    ACTOR_UUID: uuid(ids.actor), OPERATION_UUID: uuid(ids.operation),
    VIDEO_UUID: uuid(ids.video), HOLD_SECONDS: String(hold),
  }
  const sql = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
    if (!(name in replacements)) throw Error('unexpected race template placeholder')
    return replacements[name]
  })
  if (/\{\{|\}\}/.test(sql)) throw Error('unresolved race template placeholder')
  return `${sql}\nselect 'race_end', pg_backend_pid(), clock_timestamp();\n`
}

export function runConnection(sql, { executable = 'psql', environment = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-X', '-qAt', '-F', '|', '-v', 'ON_ERROR_STOP=1'],
      { env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    // Avoid printing database error text; it may contain identifying data.
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 4096) child.kill() })
    child.stderr.on('data', () => {})
    child.on('error', () => reject(Error('psql connection could not start')))
    child.on('close', code => {
      if (code !== 0) return reject(Error('psql race connection failed; inspect protected session'))
      const lines = stdout.trim().split(/\r?\n/)
      const start = lines.find(line => /^race_start\|\d+\|/.test(line))
      const outcome = lines.find(line => /^\d+\|(?:t|f)$/.test(line))
      const end = lines.find(line => /^race_end\|\d+\|/.test(line))
      if (!start || !outcome || !end) return reject(Error('race evidence incomplete'))
      const [, pid, started] = start.split('|')
      const [resultPid, result] = outcome.split('|')
      const [, endedPid, ended] = end.split('|')
      if (pid !== resultPid || pid !== endedPid || !Number.isFinite(Date.parse(started)) ||
          !Number.isFinite(Date.parse(ended))) return reject(Error('race evidence invalid'))
      resolve({ pid: Number(pid), result: result === 't', started, ended })
    })
    child.stdin.end(sql)
  })
}

export async function executeRace({ phase, ids, executable, environment }) {
  if (!['reserve', 'claim'].includes(phase)) throw Error('invalid race phase')
  const template = readFileSync(new URL(`./qc026_race_${phase}.sql.in`, import.meta.url), 'utf8')
  const [slow, fast] = await Promise.all([
    runConnection(renderRaceSql(template, ids, 4), { executable, environment }),
    runConnection(renderRaceSql(template, ids, 0), { executable, environment }),
  ])
  if (slow.pid === fast.pid ||
      Date.parse(slow.started) >= Date.parse(fast.ended) ||
      Date.parse(fast.started) >= Date.parse(slow.ended)) {
    throw Error('independent overlapping PostgreSQL sessions were not demonstrated')
  }
  if (Number(slow.result) + Number(fast.result) !== 1) {
    throw Error('race did not have exactly one winner; stop and inspect fixture')
  }
  return { phase, distinctPids: true, overlap: true, winners: 1,
    connections: [slow, fast] }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    if (required('ADP_QC026_ACCEPTANCE_AUTHORIZED') !== 'GATE2_APPROVED' ||
        required('ADP_QC026_EXPECTED_REF') !== ref ||
        required('PGDATABASE') !== 'postgres' ||
        required('PGSSLMODE') !== 'verify-full' ||
        !required('PGPASSWORD')) throw Error('protected Rehearsal gate mismatch')
    const host = required('PGHOST')
    const user = required('PGUSER')
    if (!((host === `db.${ref}.supabase.co` && user === 'postgres') ||
          (host.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`))) {
      throw Error('protected Rehearsal connection identity mismatch')
    }
    const phase = process.argv[2]
    const ids = { actor: required('ADP_QC026_FIXTURE_ADMIN_ID'),
      operation: required('ADP_QC026_RACE_OPERATION_ID'),
      video: required('ADP_QC026_RACE_VIDEO_ID') }
    console.log(JSON.stringify(await executeRace({ phase, ids })))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
