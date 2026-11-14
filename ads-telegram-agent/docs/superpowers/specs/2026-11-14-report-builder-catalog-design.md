# Report builder: isolated creation, source catalog and display mappings

User-authorized fixes and enhancements, 2026-11-14. Continue the existing vanilla JS/TypeScript app and private registry; preserve all saved groups, credentials and schedules.

## Findings
- The template New button forwards into the settings editor; the template editor keeps its old ID. Returning and saving can rename/change the old template.
- Switching to Pancake replaces the chosen metric IDs. The placeholder list therefore loses Meta choices.
- Variable chips grow with the catalog. The safe formula parser already supports +, -, *, / and parentheses but selection is hard.

## Implementation decisions
- Create an independent UUID draft inside Templates; explicit create intent, duplicate-ID rejection, latest-revision CAS and atomic creation with schedule disabled. Saving a new template never edits an existing group.
- Keep choices on every source switch. Provide searchable grouped dropdowns for numeric report metrics, formula operands and message placeholders; selected rows retain ordering/removal.
- Expand whitelisted business reporting metrics from Meta Insights and Pancake order facts. Request additional Meta fields only when selected directly or through a custom formula. Read account-level totals for nonadditive fields (reach, frequency, API ratios), never sum those across campaigns.
- Keep missing/unsupported values null and source-specific. POS fees/payments are separate facts, not extra revenue. No customer/contact/message data added to persistence or catalogs.
- Allow per-template POS status code labels, render status distribution using actual original codes; labels do not change eligibility/return rules. Add optional numeric value-to-label mapping to custom metrics. Both web and Telegram render the same labels; formula operands remain numeric.
- Existing safe arithmetic parser remains authoritative; insert ordinary operators, no eval or JavaScript execution.

## Acceptance
1. Create two groups/templates and save each; first content and schedule remain unchanged, including after refresh/interleaved state updates. Duplicate IDs and stale revisions reject.
2. Switching Meta→Pancake→Meta preserves chosen metric IDs and all Meta selectors.
3. Catalog dropdown selection inserts correct operands/placeholders; + - * / calculate on actual totals; zero/missing semantics remain unchanged.
4. Meta/POS values stay separate. Nonadditive Meta totals use a filtered combined API query.
5. Code4 can display a user label without treating return status4 as confirmed sales. Mappings survive reload and render consistently on web/Telegram, including code0.
6. Long labels, dropdowns and row controls stay inside panels; real DOM/controller/API/SQL tests, typecheck and build pass. Browser visual verification only if an authorized tool exists (currently absent).

## Compatibility ruling and evidence
New provider inputs use an uppercase namespace (META_REACH, POS_CASH), with builtin selection IDs API_META_REACH/API_POS_CASH. Previous custom metric/constant IDs were lowercase-only, so existing IDs and references require no migration. A legacy fixture with pos_cash/src_meta_reach/trang_thai_don_hang and same-named constants loads and computes unchanged beside new provider fields. New status-list placeholder is TRANG_THAI_DON_HANG for the same reason. Display maps are numeric and never reclassify POS statuses.

Catalog at implementation: 51 additional Meta fields and 53 POS fields, plus19existingmetrics =123builtin choices. It covers the supported reporting model, not every raw field across both vendors' APIs. Meta field availability remains account/permission/objective dependent; unavailable scalar/average values remain null. PII and unsupported dimensions are excluded. Source-derived reach/ratios use a filtered account-level summary query and selected custom formula dependencies.
