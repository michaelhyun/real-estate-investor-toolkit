"""Write to Supabase over PostgREST, with no SDK.

The whole ETL is stdlib-only on purpose: it runs unattended in GitHub Actions on
a monthly cron, and a pipeline that breaks because a transitive dependency
published a bad release is a pipeline that fails in the one month nobody is
watching. There is nothing here a dependency would make shorter.

Auth is the SERVICE ROLE key, which bypasses row-level security. It must never
reach the browser bundle — it lives only as the SUPABASE_SERVICE_ROLE_KEY
repository secret. The publishable key that ships to clients cannot write these
tables at all, because no insert policy exists for them.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

# PostgREST rejects an over-large body, and a failed 100k-row insert tells you
# nothing about which row was bad. Batches keep the failure legible.
BATCH = 2000


def _config():
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        raise SystemExit(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n'
            'Locally: export them from the Supabase dashboard (Settings > API).\n'
            'In CI: they are repository secrets.')
    return url, key


def _request(method: str, path: str, body=None, prefer: str = ''):
    url, key = _config()
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f'{url}/rest/v1/{path}', data=data,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        # PostgREST puts the actual reason in the body; the status alone is
        # never enough to debug a constraint violation.
        raise RuntimeError(
            f'{method} {path} -> {e.code}: {e.read().decode(errors="replace")}') from None


def upsert(table: str, rows: list[dict], conflict: str) -> int:
    """Insert-or-update `rows`, keyed on `conflict` (the table's primary key).

    Upsert rather than truncate-and-reload: a publisher revising an old month
    should overwrite that month, but a run that fails halfway must not leave the
    dashboard with a hole in it. Upsert degrades to "some months are stale",
    truncate degrades to "the dashboard is empty".
    """
    written = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        _request('POST', f'{table}?on_conflict={conflict}', chunk,
                 prefer='resolution=merge-duplicates,return=minimal')
        written += len(chunk)
    return written


def start_run() -> int:
    row = _request('POST', 'etl_runs', [{'status': 'running'}],
                   prefer='return=representation')
    return row[0]['id']


def finish_run(run_id: int, status: str, rows_written: int, detail: dict) -> None:
    _request('PATCH', f'etl_runs?id=eq.{run_id}', {
        'status': status,
        'rows_written': rows_written,
        'finished_at': 'now()',
        'detail': detail,
    }, prefer='return=minimal')
