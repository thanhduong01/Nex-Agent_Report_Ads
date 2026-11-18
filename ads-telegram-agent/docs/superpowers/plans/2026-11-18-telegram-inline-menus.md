# Telegram Inline Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Configure and execute report buttons consistently from web and Telegram.
**Architecture:** Add optional registry menu config and isolated menu/context/action modules. Reuse existing reports, request scope and delivery dedupe without replacing command logic.
**Tech Stack:** TypeScript, Zod, Eve Telegram, private Vercel Blob/local files, vanilla JS and CSS, node:test/linkedom.
**Spec:** specs/telegram-inline-menus_design.md

## Global Constraints
- Preserve old commands, report text/formulas, schedule semantics and CAS.
- Callback data <=64 bytes; private owner only; contexts expire after seven days.
- HTTPS links without credentials; no secrets or report data in button tokens.
- No new database requirement and no browser permission bypass.

## Review Focus
- A button sent before a request is disabled or scoped more narrowly must fail safely.
- A stale web revision must not overwrite groups, metrics or requests.
- Two deliveries of the same callback must send at most once.
- Explicit multi-day ranges must survive refresh and group selection.
- Long Unicode labels and mobile previews must wrap without widening the page.

### Task 1: Configuration and context contract
Files: agent/lib/telegram-menu-config.ts, telegram-menu-context.ts, groups.ts; tests/telegram-menu.test.ts.
Produces: menu schema/defaults, menuAction(body), signed immutable context write/read, pure keyboard layout.
- [x] Write failing tests for schema/reference validation, CAS preservation, owner-bound signatures, tampering, expiry and 64-byte limit.
- [x] Run node --test tests/telegram-menu.test.ts; confirm missing feature failures.
- [x] Implement schemas, context storage and token validation; run tests and typecheck.

### Task 2: Callback execution and shared delivery
Files: agent/lib/telegram-menu.ts, telegram-menu-callbacks.ts, delivery.ts, job.ts, telegram-commands.ts, telegram-setup.ts, dashboard-api.ts, scripts/dashboard/server.ts, agent/channels/telegram.ts.
Consumes: Task 1 contracts. Produces keyboard(report context), handle callback with injected QA boundaries.
- [x] Write failing action tests for auth, scope drift, duplicate delivery, supported views, custom dates and explicit date ranges.
- [x] Implement report menus, preset/group submenus, request handler, view rendering; attach to command/scheduled/manual report delivery.
- [x] Include callback_query in webhook setup; run old command/delivery/scheduler tests and new action tests.

### Task 3: Web configuration
Files: public/telegram-menu.js, index.html, app.js, sales.css; dashboard-state.ts and both API routers; scripts/build-vercel.mjs.
Consumes: registry.telegramMenu and menuAction. Produces responsive menu editor and preview.
- [x] Write failing real-DOM tests for independent edit/save/reorder/remove, retained dirty drafts and safe Unicode preview.
- [x] Add controls, accessible labels, source/request choices, mobile layout and guarded API save.
- [x] Run DOM/API tests, all tests, typecheck and production build.

### Task 4: QA and release
- [x] Hand off full diff to fresh Test Master/reviewer per Fullstack Guardian; address verified important findings with regression tests.
- [x] Run full suite, compiled HTTP/auth/static asset checks and document browser limitations.
- [x] Commit, integrate into authorized main, push and verify production deploy + scheduler/webhook registration.
