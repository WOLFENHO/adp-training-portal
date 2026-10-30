param([Parameter(Mandatory=$true)][string]$DatabaseUrl)
$ErrorActionPreference='Stop'
if (([Uri]$DatabaseUrl).Host -notin @('localhost','127.0.0.1','[::1]','::1') -or $env:ADP_ALLOW_LOCAL_DB_TEST -ne '1') { throw 'Requires opted-in disposable loopback database' }
Get-Command psql -ErrorAction Stop | Out-Null
Get-Command supabase -ErrorAction Stop | Out-Null
$repo=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
function Invoke-TestSql([string]$File,[switch]$Atomic,[switch]$Fixture) {
 $arguments=@('-X','-v','ON_ERROR_STOP=1',$DatabaseUrl,'-f',$File)
 if($Atomic){$arguments=@('--single-transaction')+$arguments}
 if($Fixture){$arguments=@('-c',"set adp.allow_progress_migration_fixture='on';")+$arguments}
 & psql @arguments
 if($LASTEXITCODE -ne 0){throw "SQL failed: $([System.IO.Path]::GetFileName($File))"}
}
try {
# Use only an empty disposable local Supabase database with auth schema and roles.
$migrations=Get-ChildItem -LiteralPath (Join-Path $repo 'supabase/migrations') -Filter '*.sql' | Sort-Object Name
foreach($migration in $migrations | Where-Object Name -lt '202610300005') { Invoke-TestSql $migration.FullName -Atomic }
Invoke-TestSql (Join-Path $PSScriptRoot 'progress_integrity_migration_before.sql') -Atomic -Fixture
foreach($migration in $migrations | Where-Object {$_.Name -ge '202610300005' -and $_.Name -lt '202610300008'}) { Invoke-TestSql $migration.FullName -Atomic }
Invoke-TestSql (Join-Path $repo 'supabase/deployment/release_1_2_1_disable_playback.sql')
$migration8=Join-Path $repo 'supabase/migrations/202610300008_release_1_2_1_integrity.sql'
$failureScript=Join-Path ([System.IO.Path]::GetTempPath()) ('adp-failure-'+[guid]::NewGuid().ToString()+'.sql')
try {
 (Get-Content -LiteralPath $migration8 -Raw) -replace 'commit;\s*$', 'select 1/0; commit;' | Set-Content -LiteralPath $failureScript
 & psql -X -v ON_ERROR_STOP=1 $DatabaseUrl -f $failureScript
 if($LASTEXITCODE -eq 0){throw 'Failure injection unexpectedly committed'}
 # A rollback must leave neither binding columns nor the new readiness marker.
 $check="do `$`$begin if exists(select 1 from information_schema.columns where table_schema='public' and table_name='watched_intervals' and column_name='asset_identity') or exists(select 1 from public.adp_integrity_release where version=121) then raise exception 'partial migration survived rollback';end if;end`$`$;"
 & psql -X -v ON_ERROR_STOP=1 $DatabaseUrl -c $check
 if($LASTEXITCODE -ne 0){throw 'Failed migration was not atomic'}
} finally { Remove-Item -LiteralPath $failureScript -ErrorAction SilentlyContinue }
Invoke-TestSql $migration8
Invoke-TestSql (Join-Path $PSScriptRoot 'progress_integrity_migration_after.sql') -Atomic
Invoke-TestSql (Join-Path $repo 'supabase/deployment/release_1_2_1_enable_playback.sql')
Invoke-TestSql (Join-Path $repo 'supabase/deployment/release_1_2_1_enable_playback.sql')
# pgTAP must be interpreted, not merely sent to psql: a failing assertion may exit psql with status 0.
& supabase test db supabase/tests/progress_integrity.sql supabase/tests/release_1_2_1.sql --db-url $DatabaseUrl
if($LASTEXITCODE -ne 0){throw 'pgTAP failed'}
$env:ADP_TEST_DATABASE_URL=$DatabaseUrl
& node (Join-Path $PSScriptRoot 'release_1_2_1_concurrency.mjs')
if($LASTEXITCODE -ne 0){throw 'Concurrent transaction tests failed'}
Invoke-TestSql (Join-Path $repo 'supabase/deployment/release_1_2_1_disable_playback.sql')
Invoke-TestSql (Join-Path $repo 'supabase/deployment/release_1_2_1_disable_playback.sql')
} finally {
 Invoke-TestSql (Join-Path $repo 'supabase/deployment/release_1_2_1_disable_playback.sql')
}
Write-Output 'Disposable rehearsal complete; playback remains disabled.'
