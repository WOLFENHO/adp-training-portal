"""Live multi-connection PostgreSQL tests for Release 1.2.

Requires a disposable local Supabase database, psycopg-free `psql`, and
ADP_TEST_DATABASE_URL. The script rejects non-loopback hostnames by default.
It creates and removes only uniquely generated test fixtures.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse


def require_local_database() -> tuple[str, str]:
    url = os.environ.get("ADP_TEST_DATABASE_URL", "")
    if not url:
        raise SystemExit("Set ADP_TEST_DATABASE_URL to a disposable local Supabase PostgreSQL URL.")
    parsed = urlparse(url)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Refusing to run: ADP_TEST_DATABASE_URL must use a loopback host.")
    if os.environ.get("ADP_ALLOW_LOCAL_DB_TEST") != "1":
        raise SystemExit("Set ADP_ALLOW_LOCAL_DB_TEST=1 after confirming the database is disposable.")
    psql = shutil.which("psql")
    if not psql:
        raise SystemExit("psql is required for real concurrent database transactions.")
    return url, psql


def run_sql(url: str, psql: str, sql: str) -> str:
    result = subprocess.run(
        [psql, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", url, "-c", sql],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        # Avoid printing connection args, which can contain credentials.
        raise RuntimeError(f"psql failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip()


def rpc_sql(uid: str, session: str, request_id: str, version: int, sequence: int,
            position: str, is_playing: bool, kind: str) -> str:
    return (
        "begin; set local role authenticated; "
        f"select set_config('request.jwt.claim.sub','{uid}',true); "
        f"select public.record_playback_heartbeat_r12('{session}','{request_id}',{version},{sequence},"
        f"{position},{str(is_playing).lower()},'{kind}')::text; commit;"
    )


def start_sql(uid: str, video: str) -> str:
    return (
        "begin; set local role authenticated; "
        f"select set_config('request.jwt.claim.sub','{uid}',true); "
        f"select public.start_playback_session_r12('{video}')::text; commit;"
    )


def json_result(output: str) -> dict:
    rows = [line for line in output.splitlines() if line.startswith("{")]
    if not rows:
        raise RuntimeError("Heartbeat SQL returned no JSON response.")
    return json.loads(rows[-1])


def main() -> int:
    url, psql = require_local_database()
    uid, video, session = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    discord_id = str(990000000000000000 + uuid.uuid4().int % 90000000000000000)
    email = f"adp-concurrency-{uid}@example.invalid"
    fixture_created = False
    try:
        setup = f"""
        begin;
        update public.adp_playback_control set enabled=true where singleton;
        insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
        values('{uid}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{email}','',clock_timestamp(),
          '{{"provider":"discord","providers":["discord"]}}'::jsonb,'{{}}'::jsonb,clock_timestamp(),clock_timestamp());
        insert into public.profiles(id,discord_id,username) values('{uid}','{discord_id}','ADP concurrency fixture');
        insert into public.authorized_discord_ids(discord_id,added_by) values('{discord_id}','local-test');
        insert into public.videos(id,title,duration_seconds,legacy_duration_seconds,duration_precision_verified,duration_verified_at,published)
        values('{video}','ADP concurrency test',100,100,true,clock_timestamp(),true);
        insert into public.playback_sessions(id,user_id,video_id,last_position,started_at,last_heartbeat_at,is_playing,active,session_version,last_event_sequence,playback_budget_seconds)
        values('{session}','{uid}','{video}',0,clock_timestamp(),clock_timestamp(),false,true,0,0,0);
        commit;
        """
        run_sql(url, psql, setup)
        fixture_created = True

        # Two independent psql processes create separate transactions. Exactly
        # one event with expected_version=0 may win the locked session row.
        barrier = threading.Barrier(2)

        def concurrent_call(sequence: int) -> dict:
            barrier.wait(timeout=10)
            output = run_sql(url, psql, rpc_sql(uid, session, str(uuid.uuid4()), 0, sequence, "0", False, "pause"))
            return json_result(output)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(concurrent_call, (1, 2)))
        if sum(result.get("accepted") is True for result in results) != 1:
            raise AssertionError(f"Concurrent compare-and-set did not produce exactly one winner: {results}")
        print("PASS: two real concurrent PostgreSQL transactions serialize on the playback-session row")

        state = run_sql(url, psql, f"select session_version,last_event_sequence,is_playing from public.playback_sessions where id='{session}'")
        version_text, sequence_text, playing_text = state.splitlines()[-1].split("|")
        version, highwater = int(version_text), int(sequence_text)

        # A malicious jump cannot poison the event stream; a normal next event
        # remains usable. This is a DB-level check, not a mocked API response.
        huge = json_result(run_sql(url, psql, rpc_sql(uid, session, str(uuid.uuid4()), version, 9007199254740991, "0", False, "pause")))
        if huge.get("code") != "sequence_out_of_range" or huge.get("lastEventSequence") != highwater:
            raise AssertionError(f"Large sequence was not safely rejected: {huge}")
        recovered = json_result(run_sql(url, psql, rpc_sql(uid, session, str(uuid.uuid4()), version, highwater + 1, "0", False, "pause")))
        if recovered.get("accepted") is not True:
            raise AssertionError(f"Normal sequence did not recover: {recovered}")
        print("PASS: malicious sequence rejection leaves high-water unchanged and legitimate event recovers")

        new_state = run_sql(url, psql, f"select session_version,last_event_sequence from public.playback_sessions where id='{session}'")
        version, highwater = map(int, new_state.splitlines()[-1].split("|"))
        delayed = json_result(run_sql(url, psql, rpc_sql(uid, session, str(uuid.uuid4()), version, highwater - 1, "0", False, "pause")))
        if delayed.get("code") != "stale_event":
            raise AssertionError(f"Delayed event with fresh version was not rejected: {delayed}")
        malformed = json_result(run_sql(url, psql, rpc_sql(uid, session, str(uuid.uuid4()), version, highwater + 1, "0", False, "unknown")))
        if malformed.get("code") != "invalid_request":
            raise AssertionError(f"Malformed event was not rejected before ordering: {malformed}")
        print("PASS: stale event carrying current version and malformed event do not alter newer state")

        # Each browser instance gets a separate server session. Starting the
        # second invalidates the first; client sequence domains are not shared.
        first_session = json_result(run_sql(url, psql, start_sql(uid, video)))['sessionId']
        second_session = json_result(run_sql(url, psql, start_sql(uid, video)))['sessionId']
        old_tab = json_result(run_sql(url, psql, rpc_sql(uid, first_session, str(uuid.uuid4()), 0, 1, "0", False, "pause")))
        if old_tab.get("code") != "session_inactive":
            raise AssertionError(f"Old player instance was not invalidated: {old_tab}")
        session = second_session
        state = run_sql(url, psql, f"select session_version,last_event_sequence from public.playback_sessions where id='{session}'")
        version, highwater = map(int, state.splitlines()[-1].split("|"))
        print("PASS: separate player sessions are isolated and the older tab cannot mutate the new session")

        # Expiry is decided by PostgreSQL time. A rejected expiry result is
        # receipt-backed so retrying it does not execute a second transition.
        run_sql(url, psql, f"update public.playback_sessions set started_at=clock_timestamp()-interval '12 hours'-interval '1 millisecond' where id='{session}'")
        expired_id = str(uuid.uuid4())
        exp = json_result(run_sql(url, psql, rpc_sql(uid, session, expired_id, version, highwater + 2, "0", False, "pause")))
        again = json_result(run_sql(url, psql, rpc_sql(uid, session, expired_id, version, highwater + 2, "0", False, "pause")))
        if exp.get("code") != "session_expired" or again.get("duplicate") is not True:
            raise AssertionError(f"Expiry/retry behavior mismatch: {exp}, {again}")
        print("PASS: database-time expiry rejects heartbeats and preserves the rejection receipt")
        return 0
    finally:
        if fixture_created:
            cleanup = f"begin; delete from public.authorized_discord_ids where discord_id='{discord_id}'; delete from public.videos where id='{video}'; delete from auth.users where id='{uid}'; update public.adp_playback_control set enabled=false where singleton; commit;"
            run_sql(url, psql, cleanup)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)


