# Meta Custom Reports Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task, with a final independent QA review.

**Goal:** Deliver configurable Meta/Sheets reports with safe custom formulas through web, Telegram and GitHub schedules.
**Architecture:** Extend group report definitions and use a shared query/render service. Store Meta credentials separately; parse formulas as data.
**Tech Stack:** Node 24, TypeScript, Eve, Zod, private Vercel Blob, vanilla browser JavaScript.
**Spec:** specs/meta_custom_reports_design.md

## Global constraints
- Keep existing Sheets registry/requests and owner-only Telegram working.
- No secrets in public state, errors, logs, tests or git.
- No eval/Function or arbitrary URL fetching.
- Missing values and untracked hotel phones never become zeros.
- Formulas apply to aggregated operands; max 93 inclusive days.

## Review focus
- Malicious formula input, unknown names and deep/cyclic dependencies.
- Meta permission failure, pagination, account/campaign mismatch and token redaction.
- Monthly boundaries and partial Sheets phone data in hybrid reports.
- Independent manual/scheduled periods and revision conflict behavior.
- Actual DOM fields, mobile wrapping, loading/validation and empty states.

## Task 1: Expression language and definitions
Files: agent/lib/formulas.ts, agent/lib/report-definition.ts, tests/formulas.test.ts.
Interfaces: validateMetrics(definitions, constants); evaluateMetrics(definitions, values); reportDefinitionSchema and metricSchema.
- [x] Write failing parser, dependency, missing/zero and aggregate tests.
- [x] Implement bounded parser/evaluator, definitions and default metrics; verify focused tests.
- [x] Commit verified slice.

## Task 2: Meta connection boundary
Files: agent/lib/private-store.ts, agent/lib/meta.ts, tests/meta.test.ts.
Interfaces: metaAction(body), listMetaConnections(), metaCampaigns(connectionId, accountId), readMetaInsights(config, range).
- [x] Write failing tests for pagination, access, safe errors, secret isolation and storage.
- [x] Implement allowlisted client and private credential storage; verify focused tests.
- [x] Commit verified slice.

## Task 3: Shared report pipeline and persistence
Files: groups.ts, report.ts, sheets.ts, report-service.ts, report-management.ts, job.ts, request-config.ts, request-actions.ts, schedule-config.ts, telegram-commands.ts, report-history.ts; tests/configured-reports.test.ts.
Interfaces: configuredReport(date, groupId, options), reportManagement(path, body), resolvePeriod(anchor, preset, from?), Report optional metrics/range/currency fields.
- [x] Write failing migration, ratio-of-totals, hybrid, range, template and command/schedule tests.
- [x] Wire definitions/metrics into registry, unified engine and existing delivery entry points.
- [x] Verify all existing tests plus new focused tests; commit.

## Task 4: Authenticated API and complete UI
Files: dashboard-api.ts, dashboard-state.ts, scripts/dashboard/server.ts, public/index.html, public/app.js, public/report-builder.js, public/style.css, tests/report-management.test.ts.
- [x] Write failing endpoint access/validation/redaction tests.
- [x] Add authenticated endpoints and dashboard metadata; build sources, templates, formula/constant and preview editors.
- [x] Update request/schedule period controls and daily report display to share the configured engine.
- [x] Verify API/DOM interactions; browser layout remains unverified because the tool reports browser use disabled.

## Task 5: QA and deployment
- [x] Run full typecheck, 63 tests and local production build; compiled native webhook integration passes with synthetic Meta data.
- [x] Independent Test Master / Fullstack Guardian review of whole branch; material issues fixed with RED→GREEN regressions.
- [ ] Update operating documentation, fast-forward main and push existing GitHub remote; verify Vercel deployment.
- [ ] Verify production assets and Telegram baseline; report the exact live-Meta credential prerequisite if still missing.
