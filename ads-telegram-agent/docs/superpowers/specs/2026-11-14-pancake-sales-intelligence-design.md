# Nex Report Ads Performance — Meta + Pancake sales intelligence

Status: proposal for review, 2026-11-14. User explicitly requests API research and a redesigned interface before the next implementation. No Production changes or live Pancake connection in this proposal.

## Goal and confirmed context

The owner wants ad performance joined to real orders, products/SKUs sold today, best sellers, and brief evidence-based product/campaign observations. Orders primarily originate in Facebook Inbox through Pancake (confirmed by owner). Preserve existing Sheets reports, custom formulas/templates, owner-only Telegram commands and GitHub Actions schedules. Keep the current Nex name and restrained blue design, but use a left navigation on desktop and a labeled menu on narrow screens to fit the expanded scope.

## Approaches considered

1. Pancake alone: its Ads Manager endpoints include ad accounts/campaigns/ad sets/ads and insights; convenient but depends on which accounts POS has linked and its sync freshness.
2. Meta + Pancake (recommended design call, not yet an owner-approved implementation): Meta remains the authoritative spend/delivery source already used by this project; Pancake provides order lines/statuses/returns and catalog. Use explicit ad IDs to join, with POS Ads Manager as an optional mapping/cross-check source. This retains existing connections and makes freshness/attribution visible.
3. Name/product-only matching: insufficient for exact attribution and rejected as an automatic reporting path. Product campaign mapping can describe promoted products but cannot prove the origin of an order.

## API evidence, checked 2026-11-14

Base URL https://pos.pages.fm/api/v1. All calls below are server-side read operations. Credentials are supplied via the documented api_key query parameter and must be stripped from logs/traces/error URLs. Shop API keys grant broad access; account API keys inherit the user's shop permissions. Prefer a dedicated suitably restricted reporting account when feasible; do not describe shop keys as natively read-only.

| Purpose | Documented endpoint and fields |
|---|---|
| Shop discovery | GET /shops returns `shops`, not universally `data`; GET /shops/{SHOP_ID} returns `shop`, including currency and pages |
| Canonical order facts | GET /shops/{SHOP_ID}/orders, pagination page_number/page_size/total_pages, updateStatus=updated_at + startDateTime/endDateTime Unix seconds |
| Order linking | ad_id, page_id, conversation_id, post_id; optional p_utm_campaign/p_utm_content etc. IDs may be absent or conflicting |
| Order details | GET /shops/{SHOP_ID}/orders/{ORDER_ID}; items.product_id/variation_id/quantity/returned_count/is_bonus_product/quantity_by_combo_products/components; status/status_history, order_currency, total_price, discounts/fees |
| Catalog | GET /shops/{SHOP_ID}/products/variations; stable shop/product/variation IDs; SKU/name/unit metadata |
| POS reconciliation | GET /shops/{SHOP_ID}/analytics/sale; split_by Variation.product_id, Variation.id, Ads.ad_id, Ads.ad_set_id, Ads.ad_campaign_id, Time.hour; discover selectable measures using analytics/get_analytic_fields |
| Optional POS ad hierarchy | GET /shops/{SHOP_ID}/ads_manager/ad_accounts, campaigns_v2, ad_sets_v2, ads_v2; ad response includes ad_campaign/ad_set and account IDs; account response includes sync_succeed_at |
| Incremental delivery | orders/products/variations_warehouses webhooks; configurable secret headers, return2xx within30s, replay possible; refetch updated orders after outages |

Sources: https://pos.pancake.vn/developers/api/en, /authentication, /order, /schemas, /product, /shop, /statistics, /ads-manager, /webhooks, /errors under the same docs root. Cached research snippets in ignored .data/pancake-docs are references only, not data fixtures.

## Accuracy contract

- Retain separate sources: POS confirmed revenue, POS delivered revenue, cash collected, Meta attributed purchase value. Never label POS confirmed revenue as cash or combine it with Meta purchase revenue.
- Primary reporting period is order-created cohort in Asia/Ho_Chi_Minh, with current status as-of sync cutoff. A separate view can use status-event dates for 'confirmed today'/'delivered today'. Header and export always state the selected basis. Do not add the two bases together. Historical cohort totals may restate after cancellations/returns; label them as-of a timestamp.
- Proposed default confirmed statuses:1,12,13,8,9,2,3,16,15; exclude new/pending/restocking/purchased/canceled/deleted/full-return and abandoned orders. Status15 contributes retained lines only. Shop-specific status policy is configurable and saved/versioned, not assumed business truth. Delivered subset3/16, partial returns handled by actual retained line evidence. Audit custom workflow/status mappings against the shop before enabling reports.
- Quantity means sum retained commercial line quantities, excluding gifts by default, after returned_count. Do not subtract return records a second time if returned_count already reflects them. Reconcile full returns and exchange/new order links. Show aggregate order count as distinct shop_id+order_id, not line count. Product-row order counts are nonadditive.
- Match by `(platform, account, ad_id)` in the authorized connection scope, then ad->adset->campaign; verify ID mapping freshness and lineage. If POS ad_id is missing, validated numeric UTM IDs can be an explicitly enabled secondary rule. A page/conversation/post alone is not proof of an ad. Conflicting IDs go to review. Do not infer campaign from product/name/phone, and do not multiply order revenue by the number of matching ads.
- Each order has at most one eligible reporting attribution under this rule. Preserve unmatched, manual, organic, out-of-scope and ambiguous separately. Coverage has explicit numerator/denominator (e.g. matched eligible confirmed orders / all eligible confirmed orders) and revenue coverage as another field. Do not call an unmatched order organic by default.
- A campaign POS ROAS is matched POS goods revenue for that cohort / same-account spend over the same calendar window. It is an operational ratio, not Meta's attribution-window ROAS or proof of causality. Display these separately. A full-store ratio is MER and never labeled campaign ROAS. Spend includes zero-order campaigns.
- SKU/product IDs are shop-scoped. Do not merge equal names across shops. Combo commercial units and component physical units are separate modes; never count parent and components together. For a mixed-product order allocate order-level discounts proportionally to eligible line value, using deterministic rounding remainder; fee/discount/return definitions are reconciled with POS before release.
- Product revenue is the sum of allocated retained line values. Campaign revenue is order-level retained goods revenue, once per order. A campaign selling several products cannot have its full spend assigned to every product. Default product view omits product CPA/profit when allocation/costs are unavailable. Optional spend allocation is labeled estimated and must conserve total spend.
- Currency normalization uses the order's currency for sales amounts and the shop currency for catalog costs. VND100/PHP100 are minor units; do not divide ordinary VND by100. Never sum mixed currencies or subtract foreign-currency cost from order revenue without an explicit dated FX rule. Default reports are one shop/account with matching reporting currency and timezone; block combined ratios until reconciled if different.
- Missing/stale/partial data is unavailable, not0. Report separate last-success timestamps and counts, pending sync/reconciliation state, and the analysis cutoff. No 'all systems synced' from config-save success alone.
- Today compares to the same elapsed local-time window of the previous7 complete comparable days. Same-hour baselines require historical state snapshots; when not available label the retrospective snapshot basis and suppress precise momentum claims until enough comparable data exists. Historical late return behavior is shown with mature cohorts, not judged on fresh orders.

## Ingestion and storage proposal

Keep secrets/configuration in the existing private store; add an actual transactional database for order facts (proposed managed PostgreSQL, provider/credentials chosen during implementation). Blob remains config/report snapshots, not a frequently rewritten single file holding every order. Schema: connections, shops, products, variations, orders, order_lines, order_status_events, ad_hierarchy, attribution, sync_jobs/cursors, immutable analysis snapshots. Unique order key shop_id+order_id; update only for a newer version, same-timestamp payload changes trigger refetch/hash reconciliation.

Persist only a reporting whitelist: shop/order/product/variation IDs, scoped ad/page identifiers, timestamps/status events, commercial quantities/returns/amounts/currency, gift/combo flags and reconciliation hashes. Drop names, phones, emails, addresses and conversation/message content before persistence or queueing. Webhook ingestion durably enqueues only the validated whitelisted projection or record ID for refetch; raw payloads are not stored by default. An exceptional diagnostic capture must be separately authorized, encrypted, access-restricted and deleted within24hours. Order webhook verifies a per-connection secret header, validates shop, size and schema, durably records/enqueues the sanitized event before acknowledging2xx. No fire-and-forget work after a Vercel response. Heavy fetching/aggregation runs in bounded jobs. Start with manual initial import7days, optionally30days in checkpoints, then updated_at polling with overlap. Products/ads metadata refresh independently. Jobs only advance the watermark after every page in the bounded interval succeeds; dedupe overlap, detect pagination loops/deletes, split oversized windows and resume. Webhooks accelerate changes; GitHub Actions polling recovers missed events. Reuse the existing signed GitHub identity checks; no new Vercel cron dependency. GitHub schedule can be delayed, so do not promise exact-minute freshness. Manual refresh enqueues a bounded delta rather than scanning an entire shop in a web request.

Conservative concurrency2–4 and below the documented GET30requests/sec cap; honor Retry-After, jittered exponential backoff and bounded attempts for429/5xx, stop retries for bad credentials. No Pancake order/stock edits or Meta budget changes in this reporting integration. Do not silently replace existing webhook URLs/headers; inspect and preserve existing shop integrations and use a relay/receiver if a single webhook slot is already in use.

## Metrics and reasoning

Expose pos_orders_created, pos_orders_confirmed, pos_orders_delivered, pos_units_retained, pos_goods_revenue, pos_matched_goods_revenue, pos_unmatched_orders, pos_returns, pos_match_rate, meta_spend. Safe formulas reuse the existing expression parser: POS CPA=meta_spend/pos_orders_confirmed_matched; POS operational ROAS=pos_matched_goods_revenue/meta_spend; MER=pos_goods_revenue/meta_spend. Zero denominator stays unavailable. Profit is unavailable until comparable currency COGS/fulfillment/fee policies are supplied.

Insights are rule-based first, optional narrative generation only from computed non-PII facts. Budget increases/cuts require a measured, sufficiently mature confirmation cohort and comparable lag distribution; until that exists, today's CPA/ROAS observations remain provisional. Shop-wide coverage does not establish campaign-specific coverage; report each campaign's resolvable lineage/eligible-source coverage before applying entity-level rules. Every observation includes entity ID, evidence counts/window/baseline, data freshness/coverage, configured threshold and recommendation. No invented age/gender/audience insight unless those breakdowns are actually fetched and privacy thresholds satisfied. Creative/adset/product evidence can be analyzed at the granularity actually available.

Proposed adjustable defaults: minimum10 matched confirmed orders, campaign age6hours, target CPA100kVND, minimum matched-revenue coverage80%, baseline7comparable days, POS snapshot age15min. These are design examples, not proven business targets. Low global coverage blocks aggregate 'scale budget' advice; well-matched individual campaigns can display an isolated preliminary efficiency fact, not an autonomous recommendation. Below-threshold campaign example: '8 orders, not enough evidence'. Product velocity, low inventory and rising return rates are independent signals with defined cohorts. All actions are suggestions; no automatic ad writes.

## Navigation and screens

1. Overview: scope/day/basis, source freshness, explicit coverage, revenue/confirmed orders/net commercial units/spend, top products, attributed campaign comparison, unmatched amount and rule observations.
2. Campaigns: spend, distinct matched confirmed orders, matched revenue, POS operational ROAS, CPA, evidence freshness; expandable adset/ad and actual sold products; Meta purchase ROAS kept separate.
3. Products: units/variant/confirmed vs delivered, net line revenue, returns, optional available stock; multi-product campaigns shown as links, no invented spend allocation. Desktop table becomes labeled cards on mobile.
4. Signals: evidence list, 'positive', 'needs review', 'insufficient' filters; explanation and editable threshold drawer, no opaque score.
5. Attribution/reconciliation: matched/unmatched/ambiguous counts and revenue; example masked order refs, reason and originating page, explicit audit trail. Manual provenance correction requires deliberate review, cannot manufacture ad evidence.
6. Sources: existing Meta/Sheets plus Pancake credential field (write-only on server), shops/pages/warehouse/account scope, source capabilities/permissions, sync state and diagnostics; webhook setup preserves existing configuration.
7. Templates/metrics: source=Meta+Pancake, scope, status/time/returns policy, safe formula catalog, select/order metrics, preview with analysis cutoff/coverage and save status; retain current legacy reports.
8. Telegram/automation: existing command+phrase config, choose report template, mode today/yesterday/7days, optional /sanpham /campaign /nhanh examples that must be enabled by the owner; schedule and freshness policy. One report engine for web/bot/schedule.
9. History: actual job/import/report result with source cutoffs, retries and saved config revision; bounded safe diagnostics, no customer PII.
10. Access and modal states: responsive sign-in, data-empty/loading/error/stale/conflict/draft-preservation. Clear confirmation for storing changes; safe three-way target-baseline check/revision CAS from existing fixes retained.

## Responsive acceptance, not an unverified guarantee

- Desktop≥1180px:220px sidebar, minmax(0,1fr) content, fixed max readable content width; dense tables locally scroll only if needed.
- Tablet768–1179: compact top navigation/menu and two summary columns; preview below form; no forced wide fieldset.
- Mobile320–767: one column forms/content, two summary tiles where each label/value fits, otherwise one; labeled dropdown navigation, data rows become cards with explicit labels. Toolbar actions wrap under labeled fields; no negative margins or body overflow hiding as a patch.
- Scope selectors use native labeled controls, min-width0, flex wrap, stable44px touch targets,16px editable text. Long campaign/SKU/URLs wrap without clipping; IDs copyable without shrinking prose. Keyboard focus, status live regions, semantic table headings, colors plus labels.
- Actual implementation gate: viewport320/375/390/768/1024/1440/1920 +200%zoom; every screen/empty/loading/error/long-name case, logged out/in; no document-wide scrollWidth beyond clientWidth, no overlapping controls; automated browser interaction/screenshots, clean console and network checks. No actual browser tool is available in this session, so the proposal cannot claim all-screen rendering verification.

## Delivery boundary and open decisions

This deliverable is an inspectable proposal with synthetic demonstration data, not connected sales data. Build should follow design approval. Before implementation, obtain authorized shop/account selection and a bounded representative7-day order sample through a secure connection (normal/late-confirmed/missing-ID/canceled/partial-return/combo examples). Measure valid ad ID coverage, resolvable lineage, conflict rate and both matched-order and matched-revenue coverage; one sample order only verifies shape. Reconcile money/returns/status policies against POS before enabling customer-facing metrics. No API key in chat. Database provisioning can follow approval; configuration and schemas must support multiple shops even if MVP reports one shop per scope. Actual shop KPI/CPA targets are configurable rather than guessed.

## Independent builder check

Completed before presenting this proposal. No additional blocking owner questions; refinements incorporated: representative join validation, confirmation-lag maturity gates and explicit PII minimization before persistence/queueing.
