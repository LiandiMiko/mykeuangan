# Audit 006: Wallet, asset, and mobile header changes

Status: User-approved findings implemented; see [follow-up](./audit-006-followup-wallets-assets-header-2026-11-17.md).

## 1. Category action needs a clear add affordance

Priority: LOW

In `src/form.html`, the add-category control is gray and contains only an icon without an accessible name. Use the requested green treatment and plus sign, and provide an accessible label. (R-31, R-39)

## 2. Wallets cannot be added or classified as e-wallets

Priority: HIGH

The dashboard only renders existing wallets, while `db/002_wallets.sql` restricts `kind` to `bank` and `cash`. Add user-managed wallets, include an e-wallet kind, and ensure transfers can use any two wallets. (R-26, C-2)

## 3. Creating an asset does not record its funding source

Priority: HIGH

`addManualAssetUI()` creates an asset without a wallet. Only the later top-up flow can debit a wallet and create an investment transfer. Let initial asset purchases select a wallet and record the asset plus debit atomically. (R-26, C-2)

## 4. Mobile header has no deliberate narrow layout

Priority: MEDIUM

The header relied on automatic flex wrapping instead of a defined mobile layout. In the narrowest browser run, the app name and controls landed on separate rows, making the result dependent on available width. Define a deliberate reflow that keeps controls readable and tappable. (R-03)
