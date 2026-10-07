# My IT Hero — build, audit and QA report

Date: 6 October 2026 · Assessment Year: **2026-27** (FY 2025-26)

## Context
No existing repository was supplied, so there was nothing to audit in step 1 of the brief; the application was built from scratch to the brief (`GPT_Prompt.docx`), then tested as an independent QA pass. The audit sections below cover the new code and the QA findings.

**Applicable year.** On 6 Oct 2026 the return being prepared is for **FY 2025-26 → AY 2026-27**, under the Income-tax Act, 1961. The original 139(1) due date for non-audit individuals (31 Jul 2026) has passed, so the app treats filing today as a belated return u/s 139(4) and applies the 234F fee. CBDT's press release of 28 Sep 2026 extends only audit cases (to 21 Nov 2026).

## A. Files
All files are new. Main ones: `myithero/{__init__,auth,api,ocr,validators,worksheet,mailer,security,db,errors}.py`, `myithero/tax/{engine,itr_select,rules}.py`, `tax_rules/AY2026-27/{rules,sources,mapping}.json`, `static/*.html`, `static/js/*.js`, `static/css/styles.css`, `tests/*`, `tools/*`, `README.md`, `PRIVACY.md`, `TERMS.md`, `DISCLAIMER.md`, `SECURITY.md`, `docs/ANNUAL_UPDATE.md`.

## B/C. Bugs found during QA, and fixes
| ID | Sev | Found by | Expected | Actual | Root cause | Fix | Regression test |
|---|---|---|---|---|---|---|---|
| QA-01 | P1 | OCR fixture test | FD interest ₹62,300 | ₹8,450 (savings line reused) | Generic "interest paid" pattern matched any line; one line could feed two fields | Each line feeds at most one field; best-confidence line wins | `test_jpeg_ocr_interest_certificate` |
| QA-02 | P2 | OCR fixture test | Professional tax ₹2,500 at high confidence | Low confidence, "multiple numbers" | `16(iii)`, `section 10` read as amounts | Section/rule references excluded from amount tokens | `test_section_numbers_not_amounts` |
| QA-03 | P1 | Browser e2e | Two files uploaded → two processed | Only first processed | FileList cleared (`input.value=""`) while async loop iterated | Copy to array before reset | e2e "Upload PDF + JPEG" |
| QA-04 | P1 | Browser e2e | Downloads page works | Page blank | JS syntax error (missing parenthesis) | Fixed; `node --check` on all JS | e2e "Generate PDF + DOCX" |
| QA-05 | P3 | Browser e2e | No console errors on public pages | 401 logged from session probe | `/api/auth/me` returned 401 when signed out | Returns 200 `{user:null}` | e2e "No JS console errors" |
| QA-06 | P2 | Screenshot review | Full navigation visible at 1366 px | "ITR Mapping" and later links clipped | 10 nav items on one row | Signed-in nav gets its own row | e2e mobile/desktop |
| QA-07 | P3 | Screenshot review | Spacing between dashboard sections | Stat tiles touching panels | Missing vertical rhythm | `main > * + *` spacing | visual |

No P0/P1 issues remain open.

## D. Remaining issues / not implemented
- Rules marked **UNVERIFIED — REQUIRES REVIEW** (see E) must be confirmed by a qualified reviewer.
- Portal **field labels** are not verified against the live portal (only ITR-1 section names are verified from the official ITR-1 FAQ). Every mapping shows its status.
- Not computed: agricultural-income partial integration (warned), relief u/s 89, brought-forward loss set-off, 234C capital-gains/dividend exception (warned), audit-case due dates (warned), HUF/firms, ITR-U, revised returns.
- AIS / 26AS / TIS are classified but their tabular contents are not parsed into fields (values must be entered/confirmed manually); cross-document reconciliation works for any field extracted from two sources.
- HEIC/HEIF: detection and ImageMagick conversion are implemented and unit-tested at the type-validation level, but **no real HEIC file was available** in the build environment to test conversion end-to-end.
- SMS OTP: no gateway integrated; mobile verification works only in development mode until `SMS_PROVIDER_URL` integration is written.
- No antivirus scanning; in-memory rate limiter; no encrypted-at-rest database (see SECURITY.md).
- Legal pages are drafts and need legal review.

**Status: not production-ready** until the rule review, portal-label verification, SMS gateway and AV scanning are completed.

## E. Tax rules (AY 2026-27)
| Rule | Source | Status | Tests |
|---|---|---|---|
| New-regime slabs 0/5/10/15/20/25/30% at 4/8/12/16/20/24 lakh | SRC-ITD-SAL-AY2627 | VERIFIED | slab boundaries ±₹1 |
| Old-regime slabs (<60, 60-79, 80+) | SRC-ITD-SAL-AY2627 | VERIFIED | age bands |
| Rebate 87A: new ₹60,000 ≤ ₹12 lakh; old ₹12,500 ≤ ₹5 lakh | SRC-ITD-SAL-AY2627 | VERIFIED | boundary −1/0/+1 |
| Marginal relief above ₹12 lakh (new) | SRC-ITD-SAL-AY2627 | Implemented; interaction with special-rate income UNVERIFIED | 12,00,010 / 12,10,000 / 13,00,000 |
| Rebate not applied to 111A/112A tax | — | UNVERIFIED — REQUIRES REVIEW | `test_rebate_not_on_special_rate_tax` |
| Surcharge 10/15/25/37% (new capped 25%), 15% cap on special-rate income | SRC-ITD-SAL-AY2627 | VERIFIED | 50 L marginal relief, 6 Cr |
| Cess 4% | SRC-ITD-SAL-AY2627 | VERIFIED | all |
| Standard deduction ₹75,000 new / ₹50,000 old | SRC-ACT-1961 | UNVERIFIED — REQUIRES REVIEW | capped at salary |
| 80C ₹1.5 L, 80CCD(1B) ₹50k, 80D ₹25k/₹50k, 80TTA ₹10k, 80TTB ₹50k, 24(b) ₹2 L (old) | SRC-ITD-SAL-AY2627 | VERIFIED | limits, senior |
| New regime allows only 80CCD(2) (14%), 80CCH, 24(b) let-out | SRC-ITD-SAL-AY2627 | VERIFIED | disallowed-deduction test |
| 111A 20%, 112A 12.5% above ₹1.25 L | SRC-ITD-SAL-AY2627 (exemption) / Act (rates) | exemption VERIFIED, rates UNVERIFIED | special-rate test |
| 234A/B/C 1% p.m., 234F ₹5,000/₹1,000 | SRC-ACT-1961 | UNVERIFIED — REQUIRES REVIEW | interest/fee tests |
| Rounding to ₹10 (288A/288B) | SRC-ACT-1961 | UNVERIFIED — REQUIRES REVIEW | rounding test |
| Due dates: audit 21 Nov 2026 | SRC-CBDT-PR-2026-09-28 | VERIFIED | — |
| Due dates: non-audit 31 Jul 2026, belated 31 Dec 2026 | — | UNVERIFIED — REQUIRES REVIEW | belated warnings |
| ITR-1: resident, ≤ ₹50 L, ≤ 2 house properties, 112A ≤ ₹1.25 L, agri ≤ ₹5,000, exclusions | SRC-ITD-ITR1-FAQ | VERIFIED | ITR selection tests |
| ITR-4 house-property limit | SRC-ITD-ITR4-FAQ | UNVERIFIED — REQUIRES REVIEW | business tests |

## F. Official sources used
- Income Tax Department — Salaried Individuals for AY 2026-27: https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1
- Senior Citizens for AY 2026-27: https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-2
- ITR-1 (Sahaj) FAQs: https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/ITR1-FAQ
- ITR-1 Validation Rules AY 2026-27 (listed, not yet compared line-by-line): https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT_e-Filing_ITR%201_Validation%20Rules_AY%202026-27.pdf
- CBDT press release 28 Sep 2026 (due-date extension, audit cases): https://www.incometaxindia.gov.in/documents/d/guest/cbdt-extends-due-date-for-furnishing-return-of-income-for-ay-2026-27-pdf
- Downloads — ITR forms and utilities: https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns

## G. Test results
- `python3 tools/run_tests.py`: **94 / 94 passed** (tax engine 36, OCR/validators 20, API/auth/security/IDOR/documents/email/ITR 38).
- `tests/e2e_browser.py` (Chromium, desktop 1366 px + mobile 390 px): **18 / 18 passed** — signup with OTP, upload PDF + JPEG, invalid uploads, accept values, cross-document conflict, My Return validation, both regimes, calculation, mapping copy button, PDF + DOCX generation and download, email-not-configured message, dashboard, admin, mobile layout, unauthorized access, logout, password reset, mobile-number sign-in, account deletion.

## H–J
Environment variables and deployment: README.md. Annual update procedure: docs/ANNUAL_UPDATE.md.
