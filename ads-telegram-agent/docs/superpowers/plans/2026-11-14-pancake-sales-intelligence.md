# Pancake Sales Intelligence Implementation Plan

> **For agentic workers:** Use executing-plans task-by-task; one independent Test Master QA and final branch review.

**Goal:** Read-only Pancake integration with durable incremental orders, exact-ID Meta matching, truthful sales metrics, responsive web, custom templates, Telegram and schedules.
**Architecture:** Private connection config + PostgreSQL reporting facts/jobs + shared deterministic report engine. PostgreSQL migration and adapters are tested in PGlite; production DATABASE_URL must be configured. No raw customer PII persisted. Existing v1 registry migrates additively.
**Tech Stack:** Node24, TypeScript/Zod, pg/PostgreSQL; PGlite for isolated SQL tests; existing Eve/Blob/vanilla web/GitHub Actions.
**Spec:** ../specs/2026-11-14-pancake-sales-intelligence-design.md (approved 2026-11-14)

## Global Constraints
- Preserve existing Sheets/Meta/phone rules, private owner bot and signed scheduler.
- Fixed POS origin; query credentials never logged/returned; scope connection/shop/account. No Pancake edits.
- One shop/account/currency/timezone per template; unmatched/ambiguous separated, zero denominators unavailable.
- Durable jobs and whitelisted facts before webhook acknowledgements; bounded pages/resume, overlap and newer-version upserts.
- All new API writes authenticated + origin checked; webhook has its own per-connection secret with constant-time verification.
- Tablet/mobile reflow; exact typed metrics and freshness/coverage. No fabricated production data or broad promise of zero bugs.

## Review Focus
1. Partial refunds, gifts, mixed currencies and combos must not inflate sales or quantities.
2. Pagination or API errors must not advance sync cursors or turn missing data into zero.
3. Cross-shop/ad scope, PII and tokens must never leak to UI, bot, logs or persisted raw events.
4. Concurrent jobs/webhook replays must not double-count or overwrite newer records.
5. UI save races, long names and unavailable databases must preserve drafts and keep legacy screens usable.

## Task1 — facts and deterministic analytics
Files: agent/lib/pancake/types.ts, normalize.ts, analytics.ts; tests/pancake-analytics.test.ts.
Interfaces: normalizeOrder(raw,shop): OrderFact; analyzeSales(orders,ads,spend,policy,range,quality): SalesReport.
- [x] RED: currency units, retained lines/gifts/discount rounding, status/time boundaries, ambiguous attribution, zero campaign orders, unavailable source, ratios and insight gates.
- [x] Implement validated PII-free facts; deterministic matched campaign and product aggregates, no invented allocation or demographics.
- [x] GREEN focused; commit.

## Task2 — durable SQL store and sync
Files: agent/lib/pancake/database.ts, store.ts, client.ts, connections.ts, sync.ts, webhook.ts; migrations/001-pancake.sql; tests/pancake-store.test.ts, pancake-sync.test.ts.
Interfaces: SalesStore upsert/read orders; queue/claim/checkpoint/complete jobs; connection actions; runSyncBatch(store,connection,job), ingestWebhook(request).
- [x] RED: real SQL migration/idempotent upserts, duplicate/outdated events, scoped leases, persistent page checkpoint, failure cursor, API pages/redaction/auth, malformed webhooks.
- [x] Implement transactional PostgreSQL, pure adapter tests, migration bootstrap; bounded POS read client; page-scoped durable sync with initial7day import, recovery overlap and catalog refresh.
- [x] GREEN focused; commit.

## Task3 — reporting and delivery integration
Files: existing report-definition/formulas/report-service/report-management/dashboard-state/dashboard-api/scheduler-api, new pancake/api.ts/report.ts, channels/dashboard.ts and scripts/dashboard/server.ts.
Interfaces: source pancake, pancakeConnectionId/shopId, status/basis thresholds; shared SalesReport DTO under Report.sales, POS base variables/placeholders; API pancake connect/sync/status/report; public-secret webhook.
- [x] RED: auth/CSRF, scope/missing DB/no-token leaks, formula/report web/bot consistency and schedule sync without existing schedule regression.
- [x] Extend registry schemas and guarded API; consume bounded cached SQL snapshot for all reports; external requests only on sync; scheduler processes pending sync batches within its budget, keeps manual reporting available.
- [x] GREEN all existing/new tests; commit.

## Task4 — responsive real UI
Files: public/index.html/style.css/app.js/report-builder.js, new public/sales.js/sales.css; real Sources config and product/campaign/matching/signals pages, sales group picker, no demo data; bot settings reuse current request/schedule pages.
- [x] Add client-controller tests for routes, scope/date changes, null/error/loading/stale displays, CSRF API payloads and preserved draft saves.
- [x] Implement sidebar desktop + labeled mobile nav; summary/campaign/product/reconciliation/insights; sources connection wizard and sync progress, template policy/formulas; retain legacy report.
- [x] GREEN real DOM controller and compiled HTTP checks. Browser unavailable: no visual viewport verification claim.
- [x] Commit.

## Task5 — QA/review/deploy
- [x] Test Master inspected integration; independent whole-branch review completed. Findings corrected with root regression tests; no new blocking finding from QA.
- [x] Full95 tests/typecheck/build/JS; PGlite migration and compiled HTTP smoke. No production secrets/private fixtures in diff.
- [x] README Supabase setup, database prerequisite, sync/attribution rules and troubleshooting.
- [x] Pushed authorized GitHub/main. Vercel READY; root/JS/CSS HTTP200 and protected APIs checked. Signed GitHub probe succeeded; database URI validation fails before connection.
- [ ] Live prerequisite: owner must correct ProductionDATABASE_URL (CONFIGURATION before SQL authentication) and enter Pancake key/shop on web. Secrets never requested in chat; no webhook replaced.
