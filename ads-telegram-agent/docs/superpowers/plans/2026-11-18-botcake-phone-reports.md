# Botcake Phone Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Connect Botcake, deduplicate stored phone numbers per Page for life, and expose the agreed fields in web/formulas/Telegram without changing existing reports.
**Architecture:** Add an optional Botcake attachment to existing report definitions. Keep credentials/data key in existing private configuration, new jobs/ledger in private PostgreSQL tables, and bounded API sync in the existing scheduler. Reuse existing formula and message renderers through an additive metric catalog.
**Tech Stack:** Node 24, TypeScript, Zod, Eve, PostgreSQL/Supabase, Vercel Blob, vanilla JS/CSS, node:test, PGlite/linkedom.
**Spec:** docs/superpowers/specs/2026-11-18-botcake-unique-phone-design.md

## Global Constraints
- Deduplicate by stable Page ID + canonical phone, never day/campaign/group/connection token.
- Only profile/selected Custom Fields; no message contents.
- Initial import seeds old numbers; only subsequent new numbers enter new-phone metrics.
- Freeze recorded day (Vietnam date from initial valid last_interactive_at) and ad ID; update last interaction separately.
- No overwriting old metric IDs, report source semantics, credentials, database facts or schedules.
- New module failures must not break old sources or falsely turn incomplete data into zero.
- No Vercel Cron; use existing GitHub Actions and bounded manual sync.

## Review Focus
- Same number in different formats/PSIDs or concurrent jobs must count once per Page.
- Changing API token/reconnecting/configuring fields must preserve old ledger and not inflate the first import.
- An older customer acquiring a phone must be detected; subscription order is not interaction order.
- Zero, incomplete sync, missing date and unresolvable ad ID need distinct handling.
- New default catalog variables must not collide with old custom metrics/constants or alter old requests.

### Task 1: API and canonical data contracts
Files: agent/lib/botcake/types.ts, client.ts, phones.ts, catalog.ts; tests/botcake-client.test.ts.
Produces: validated read-only fixed-origin client list/info/fields methods; UTC parsing, normalization and whitelisted DTOs.
- [x] Write failing tests for documented response variants, cursors, source fields, UTC rollover, phone normalization and safe API errors.
- [x] Implement minimal client/normalizer/catalog; run focused tests and typecheck.

### Task 2: Durable private ledger and sync
Files: agent/lib/botcake/store.ts, crypto.ts, connections.ts, sync.ts, api.ts; tests/botcake-store.test.ts, botcake-sync.test.ts.
Produces: unique ledger, stable encryption/HMAC key, leased cursor jobs, first-import/config-baseline behavior, safe connection/status/ledger actions.
- [x] Write PGlite tests reproducing cross-day/page/token/concurrency duplicates, retries, null timestamps and unchanged frozen attribution.
- [x] Implement parameterized SQL and immutable recording, bounded source scan and retry; verify ciphertext never contains raw phones.
- [x] Run focused API/store/sync tests and commit the slice.

### Task 3: Report/formula/scheduler integration
Files: botcake/report.ts, report-definition.ts, report-service.ts, report.ts, formulas.ts, dashboard-state.ts, both API routers, scheduler-api.ts.
Produces: optional report.botcake config, namespaced numeric/text variables, exact Meta attribution, safe missing/freshness states, shared web/Telegram/scheduled rendering.
- [x] Write failing integration tests with Meta/POS fixtures and saved legacy definitions/metrics.
- [x] Add optional schema/catalog/reader branches and isolated scheduler tick; preserve old code path when disabled.
- [x] Verify existing full suite, template preview, custom formulas and Telegram regression tests; commit.

### Task 4: Production interface
Files: public/botcake.js, index.html, report-builder.js, app.js, sales.css, scripts/dashboard/server.ts, scripts/build-vercel.mjs.
Produces: connection/field selection/sync/ledger UI, optional report Page selector, dropdown metrics/placeholders and responsive Telegram preview controls.
- [x] Write failing real-DOM tests for create/edit/CAS/dirty state, selecting Pages/metrics, formula/token insertion and unavailable-data states.
- [x] Implement UI using existing design and helpers; test script boot order, new local assets and mobile reflow.
- [x] Run DOM/API tests, all tests, typecheck/build and compiled HTTP integration.

### Task 5: Independent QA and production release
- [x] Hand off complete diff to fresh Test Master per Fullstack Guardian; fix verified important bugs with regression tests.
- [x] Exercise desktop/mobile and existing app flows through available browser tools, without extracting credentials.
- [ ] Push authorized main, verify Vercel assets/auth, run signed scheduler probe to initialize new tables.
- [ ] Check real Botcake data after owner enters Page token through the protected website; state any genuine remaining external prerequisite.
