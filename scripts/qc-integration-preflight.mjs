import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const rehearsalRef = 'nqqarmkgnuvvqnvnodyc'
const productionRef = 'ebwtainwlgruoglyckui'

export function validateTarget(connection, expectedRef) {
  if (expectedRef !== rehearsalRef) throw new Error('ADP-ISO-001: unapproved rehearsal project')
  const url = new URL(connection)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== `db.${rehearsalRef}.supabase.co` ||
      url.hostname.includes(productionRef)) throw new Error('ADP-ISO-002: database host mismatch')
  return { projectRef: rehearsalRef, host: url.hostname }
}

export const catalogQuery = `select jsonb_build_object(
  'server_version',current_setting('server_version'),
  'tables',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')),
  'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',coalesce(p.proacl::text,''),'definition_hash',md5(pg_get_functiondef(p.oid))) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace),
  'policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using_hash',md5(coalesce(qual,'')),'check_hash',md5(coalesce(with_check,''))) order by tablename,policyname),'[]'::jsonb) from pg_policies where schemaname='public'),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition_hash',md5(pg_get_triggerdef(t.oid))) order by c.relname,t.tgname),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal),
  'release',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.adp_integrity_release r)
)::text`

export function runReadOnlyPreflight({ connection = process.env.ADP_QC_DATABASE_URL, expectedRef = process.env.ADP_QC_EXPECTED_REF } = {}) {
  const target = validateTarget(connection, expectedRef)
  const url = new URL(connection)
  // No mutation-capable SQL is accepted. The session is read-only even if the connection role is privileged.
  const child = spawnSync('psql', ['-h', target.host, '-p', url.port || '5432', '-U', decodeURIComponent(url.username),
    '-d', url.pathname.slice(1), '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
    `begin read only; ${catalogQuery}; rollback;`], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGOPTIONS: '-c default_transaction_read_only=on' }
  })
  if (child.error || child.status !== 0) throw new Error('ADP-ISO-003: read-only catalog query failed')
  const json = child.stdout.split('\n').find(line => line.startsWith('{'))
  if (!json) throw new Error('ADP-ISO-004: missing catalog result')
  const catalog = JSON.parse(json)
  return { ...target, catalog, fingerprint: createHash('sha256').update(JSON.stringify(catalog)).digest('hex') }
}

if (process.argv[1]?.endsWith('/qc-integration-preflight.mjs')) {
  try { console.log(JSON.stringify(runReadOnlyPreflight())) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
