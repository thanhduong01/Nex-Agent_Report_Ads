# Meta sources, report templates and custom metrics

Status: implementing the user's approved proposal, 2026-11-06.

## Acceptance criteria

- Existing monthly Sheets groups, owner-only Telegram commands and GitHub schedules continue to work without migration input.
- An authenticated operator can save/check a Meta system-user connection, discover accounts/campaigns and select a single account per report. Credentials never appear in dashboard state, previews, logs or source control.
- A group can use Sheets, Meta, or Meta plus a selected Sheets product for phone counts. Meta-only reports do not invent phone counts. Hotel phones remain untracked.
- Each group can save a report definition: source, account/campaign IDs, selected and ordered metrics, default period, comparison, constants, detail level and text template.
- Custom metrics support arithmetic, comparisons, IF, ROUND, ABS, MIN, MAX, SUM and COALESCE; references to other metrics; units, decimals and total/row/both scope. Missing operands, zero denominators and nonfinite values are unavailable. Unknown names, cycles and executable JavaScript are rejected.
- Period totals are aggregated first and formulas evaluated afterwards. Ratio totals never average daily ratios.
- Web preview, Telegram requests and scheduled delivery use the same report engine. Commands may override with one date or an inclusive date range. Schedules independently choose today/yesterday/7 days/month.
- The operator can preview a definition before saving, see validation errors, and view recent run outcomes. No silent source fallback or fake zero after a source error.

## Frontend

Keep vanilla JavaScript and the established visual language. Add Sources and Templates routes, a metric editor with variable insertion and formula preview, source/campaign controls, period controls, ordered metric selection and plain-text template editing. Reuse existing group and request/schedule editors. Use visible labels, loading/empty/error states, revision conflicts and textContent for user data. Mobile layouts stack.

## Backend

- Registry v1 gains optional/defaulted metrics; groups gain optional report definitions. Existing absent definitions retain the daily Sheets behavior.
- Meta credentials live in a separate server-only private Blob object (0600 local file); connection APIs return explicit metadata only. Updating/removing a token never modifies report configuration implicitly.
- Meta REST requests use an allowlisted Graph origin, pinned v26.0 (official SDK default verified 2026-11-06), Authorization header, safe errors, bounded pagination, timeout and retry limits. Account access is validated against the stored connection; campaign IDs are validated against that account.
- A shared report service builds inclusive ranges up to 93 days and previous matching periods, reads monthly Sheets at most once per query, aggregates additive Meta metrics and applies formulas. Do not expose or sum non-additive reach.
- One account per template avoids mixing currencies/timezones. The Meta account currency and timezone are attached to the result. Hybrid SĐT is attached once to the selected Sheets product, not duplicated per campaign.
- Templates allow only validated placeholders. Results exceeding Telegram's limit are rejected clearly; no partial silent truncation.
- Bounded private run history records metadata/outcome, never tokens or raw third-party errors.

## Security checkpoint (completed before product code)

- Auth/authz: existing signed HttpOnly admin session and exact private Telegram owner; all new API routes pass existing origin/content-type/header checks.
- Validation: Zod on server; HTML constraints/client checks for usability. Formula parser has token/depth/length/evaluation bounds, no eval/Function/member access.
- Output: explicit connection metadata DTO, safe operational errors, textContent rendering, no credential-bearing URL or pagination redirect.
- Storage: private Blob access server-side, environment-scoped paths; local mode files 0600. No new public data routes.
- Rate limits: bounded Meta calls and admin connection/formula-preview throttles; no credential values in logs.
- Persistence: optimistic registry revision with existing Blob compare-and-swap; connection objects written atomically with separate metadata, references checked before deletion.
- No SQL is introduced; existing JSON stores remain, so SQL parameterization does not apply.

## Decisions

1. Extend existing group configuration rather than build a parallel reporting app. A group is a reusable report template, and multiple groups can reference the same connection.
2. Use a small parsed expression language rather than execute user JavaScript. This limits functions intentionally and makes null/zero semantics predictable.
3. Query Meta on demand with bounded synchronous pagination first. Large asynchronous exports/warehouse sync and free-form AI interpretation remain separate future work; neither is required for configured reports.
4. Keep credentials separate from the registry and never return stored token values. Private Blob storage uses the existing server-side access boundary; application-wide credential export is not supported.

## Verification

Use Node 24 node:test tests with synthetic fixtures: malicious formulas and cycles, missing/zero data, ratio-of-totals, migration/conflicts, Meta account boundaries/pagination/errors/redaction, API auth/CSRF, source/period/template integration and schedule/command parity. Run typecheck/full tests/build, verify browser UI when the local browser surface is available, then review the whole diff before deploying.

Live account validation requires the operator to enter a valid system-user token in the new authenticated Sources page; never request the token in chat.
