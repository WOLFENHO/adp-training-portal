# Independent application corrections (isolated candidate)

Base: `38e893bbc01d2033f59262281eb3a50d2feaf132`. No production deployment or database migration is part of this branch. QC-014 stays blocked; its probe remains disabled by default.

| Astra ID | Correction | Regression evidence | Remaining work |
| --- | --- | --- | --- |
| QC-004 | `video-delete` rejects with 409 before calling Mux or deleting a database record. Dashboard directs operators to unpublish through the existing save action. | `qc_admin_routes.test.cjs`: provider and database delete are not invoked. | Design an approved, durable deletion/archive workflow if physical deletion is needed. No automatic asset removal. |
| QC-008 | Playback-token route signs using verified stored duration and sets `private, no-store`. | `qc_admin_routes.test.cjs`: 2424.367-second fixture reaches signer. | Idle token renewal still needs an authenticated browser fixture; long pauses remain an expiry risk. |
| QC-011 | Library and watch pages distinguish database errors from valid empty results, with retryable error boundaries. | `qc_required_query.test.mjs`: error throws bounded code, empty data remains empty. | Authenticated browser outage test in a protected isolated Preview. |
| QC-012 | Update selects the affected ID and returns 404 when no row matched. | `qc_admin_routes.test.cjs`: zero-row update rejected. | Data API integration test with a disposable video. |
| QC-018 | Heartbeat transport failures get an occurrence correlation ID, bounded code and message, and redacted server log. Successful heartbeats no longer produce per-event logs; browser no longer logs raw responses. | `qc_heartbeat_errors.test.cjs`, `heartbeat_response.test.mjs`: secret canary absent and raw body not retained. | Expand central registry to all routes, retention design, diagnostics access review. |
| QC-025 | Token and session routes reject malformed UUIDs; signing exception returns sanitized 503 and no-store. | `qc_admin_routes.test.cjs`: malformed ID avoids query, signing exception has bounded response. | Deadline and exception mapping across other providers/routes. |

These are intentionally narrow corrections. SQL, access grants, whitelist policies, playback budget, anti-skip, verified completion and curriculum progression remain untouched. Roll back this branch by reverting its application commits; no production records need restoration. Before promotion, run authenticated Preview tests for token expiry, playback, administrative unpublish, database outage and heartbeat rejection. Do not claim those workflows are verified from local mocks.

Other findings remain open: QC-003 requires a playback assurance decision and isolated SQL/browser tests; QC-005/006/013/023 require isolated database transactions and ACL checks; QC-007/009/010/016/017/019/021/026 need additional fixture and UI work. QC-020 is a product decision. QC-022/024 require operational retention and token-revocation policy. QC-014 remains blocked on protected credential identity verification; automatic Preview deployments stay paused.
