# QC-017 dashboard scaling design

Current dashboard fetches six entire tables, with a 2,000-row fail-visible cap per table and a 50,000 profile-video pair limit. The progress view joins arrays in the browser. This prevents silent truncation but cannot serve a larger organization.

Proposed application-only replacement, behind the existing authenticated, whitelisted administrator check:

1. Split `/api/admin` into `summary`, `users`, `videos` and `progress` read modes. Each response is `private, no-store`, with a maximum page size of 100 and a bounded response byte limit. Use stable keyset cursors (`id`, or the full composite primary key), not offset scans. Do not return `select('*')` or unused profile fields.
2. Return `hasMore` and an opaque, tamper-checked cursor tied to mode and filters. Fetch only the active tab. Show loading, retry and a clear end-of-list state. A failed page must not be shown as a complete dataset.
3. Replace the browser's profile × video expansion with a server-side, paged query of actual progress rows and verified completion state. An explicit filter can request a member's unstarted videos. Keep historical and verified completion distinct. Database indexes and execution plans need an isolated Release 121 fixture before choosing an RPC or view.
4. Use one authorized database snapshot per page where feasible; keyset ordering avoids duplicates under concurrent inserts, while updates/deletes may still change later pages. Include an `asOf` watermark for a consistent export if administrators need one.

Security checks: reject cursor tampering, enforce authorization on every page, cap `limit`, rate-limit expensive filters, redact errors, and avoid service-role data exposure through raw row passthrough. Test 0/1/100/101/10,000 rows, concurrent insert/delete, revoked administrator between pages, malformed cursor, response-size cap, mobile table navigation and keyboard pagination. A later schema-backed aggregation needs a separate migration and rollback. Keep the current cap until this replacement passes isolated integration tests.
