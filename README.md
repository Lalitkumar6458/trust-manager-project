# Trust Manager – Donation & Accounting Web Panel

Next.js 16 + React 19 + Ant Design 6 + Firebase (Auth, Firestore, Storage, optional Cloud Functions).

A complete **Trust Financial Management System**: every rupee is traceable from
*donor → category/purpose → bank/cash account → balance → expense → payee → purpose → document → approver → monthly/yearly totals → audit*.

---

## 1. Features (requirement → where it is)

| # | Requirement | Screen / file |
|---|---|---|
| 3 | Roles: Super Admin, Accountant, Data Entry Operator, Auditor/CA | `src/lib/permissions.js`, `firestore.rules`, **Users & Roles** |
| 4 | Dashboard cards + 7 charts | **Dashboard** |
| 5–6 | Donation entry (multi-category lines, all payment modes, UTR / cheque, documents) + configurable categories | **Donations**, **Settings → Donation categories** |
| 7 | Donor profile, FY-wise / category-wise totals, history | **Donors** |
| 8 | Hindi receipt PDF (matches the printed दान रसीद format), donor/office copy, print/download | `src/pdf/DonationReceiptPdf.js` |
| 9–10 | Expenses / payment vouchers (भुगतान वाउचर PDF), configurable categories | **Expenses**, `src/pdf/PaymentVoucherPdf.js` |
| 11 | Beneficiaries & vendors with payment history | **Beneficiaries**, **Vendors** |
| 12–14 | Multiple bank accounts, cash book, full ledger with running balance, transfers / deposit / withdrawal / charges / interest / adjustment | **Bank Accounts**, **Cash Book**, **Transactions / Ledger** |
| 15 | Bank reconciliation – CSV/Excel import, auto-match, manual match, difference | **Bank Reconciliation** |
| 16 | Funds / projects (received − spent = remaining) | **Funds / Projects** |
| 17, 28 | Monthly report + monthly closing (locks month) | **Reports → Monthly Financial Report**, **Monthly Closing** |
| 18, 29 | Financial years, year-end checklist, carry-forward of closing balances, lock | **Financial Year** |
| 19 | Annual audit: status flow Draft → Under Review → Completed → Finalized, auditor details, assets/liabilities, audit documents | **Audit** |
| 20, 21, 35 | 35 reports with filters + Excel / CSV / PDF / Print | **Reports** (`src/reports/definitions.js`) |
| 22 | Global search (donor, receipt, voucher, UTR, mobile, PAN, cheque…) | header search box |
| 23 | Documents in Firebase Storage (never deleted – archived) | **Documents** + tab on every record |
| 24, 26 | Approval workflows, no delete – void + automatic reversal entry | services `donations.js`, `expenses.js` |
| 25 | Audit trail: user, time, action, old → new value, reason, device | **Audit Logs**, tab on every record |
| 27 | In-app notifications (bell) + optional scheduled digests | `NotificationBell`, `functions/` |
| 30–31 | Trust master settings, logo/deity images, signature, stamp, trustees | **Settings**, **Trustees** |
| 34 | Security: role rules, period locks, masked bank numbers, append-only logs | `firestore.rules`, `storage.rules` |

### Workflows
* **Donation:** Draft → Submitted (receipt no. issued) → Verified → **Approved** (posted to ledger; account balance, donor totals and fund totals updated).
  Accountant/Admin can use *“Save, verify & approve”* at the counter.
* **Expense:** Draft → Submitted (voucher no. issued) → Approved → **Paid** (posted to ledger).
* **Correction:** posted entries are never edited or deleted. **Void** posts a reversal entry on today's date and reverts all totals; the original stays for audit.
* **Locks:** closed month → only Super Admin; closed FY → only Super Admin; finalized FY → nobody (use an adjustment entry in the current year).

### Balance formula
`Opening balance + Donations + Other income ± Adjustments − Expenses − Bank charges = Available balance`
Bank and cash are tracked per account; internal transfers (cash deposit / withdrawal / bank-to-bank) net to zero.

---

## 2. Setup (local)

**Requirements:** Node.js 20.9+ (22 recommended), a Firebase project.

1. **Create Firebase project** → enable
   * Authentication → Sign-in method → **Email/Password**
   * **Firestore** (production mode, region `asia-south1` recommended)
   * **Storage**
2. **Register a Web app** (Project settings → Your apps) and copy its config.
3. ```bash
   cp .env.example .env.local      # fill NEXT_PUBLIC_FIREBASE_* values
   npm install
   ```
4. **Deploy rules & indexes** (needs the Firebase CLI: `npm i -g firebase-tools`, `firebase login`):
   ```bash
   cp .firebaserc.example .firebaserc   # put your project id
   npm run deploy:rules
   ```
5. **Run**
   ```bash
   npm run dev     # http://localhost:3000
   ```
   Open **/setup** once → creates the Super Admin, trust profile, default categories, a Cash account and the current FY.
6. **Storage CORS** (needed so logo / deity / signature / stamp images appear inside PDFs). Edit origins in `cors.json`, then:
   ```bash
   gsutil cors set cors.json gs://<your-bucket>
   ```
7. **Staff logins (Users & Roles → Add user)** use the server route `src/app/api/admin/users/route.js` (Firebase Admin SDK).
   Firebase console → Project settings → Service accounts → *Generate new private key*, then set in `.env.local`:
   `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`.
   Never commit this key.

### First-day checklist
1. Settings → trust details, 12A/80G numbers, receipt texts, upload images → *Sample receipt* to preview.
2. Bank Accounts → add each bank account with its **opening balance as on 1 April**.
3. Cash Book → check cash opening (set during setup).
4. Funds / Projects (optional) → create restricted funds; link donation categories to a default fund.
5. Users & Roles → add accountant / operator / auditor logins.

---

## 3. Deploy

* **Vercel / any Node host:** `npm run build && npm start`; add all env vars.
* **Firebase App Hosting:** connect the repo; env vars in `apphosting.yaml` / console. On App Hosting the Admin SDK uses default credentials automatically (FIREBASE_ADMIN_* not needed).
* **Cloud Functions (optional, Blaze plan):** `npm run deploy:functions`
  * `audit*` triggers – tamper-proof server-side mirror (`serverAuditLogs`) of every financial change
  * `monthlyReport` – 1st of every month 06:05 IST, stores last month's summary + notification
  * `dailyPendingDigest` – 09:00 IST reminder of pending approvals / unreconciled bank lines
* **App Check (optional):** set `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` and enforce App Check in the console.
* **Backups:** Settings → **Backup** downloads every collection as one Excel file (Super Admin). Also enable Firestore *Point-in-time recovery* and scheduled backups (Firebase console → Firestore → Disaster recovery), or `gcloud firestore export gs://<bucket>/backups`.
* **Functions region:** v2 Firestore triggers must be in the same region as the database. Put `FUNCTIONS_REGION=asia-south1` (or the region of your DB) in `functions/.env`.
* `ensureNextFy` (functions) creates next year's FY every March so entries work from 1 April. Without functions, the Super Admin sees a **"Create FY"** banner on 1 April.

### Production go-live checklist

1. `npm run deploy:backend` – Firestore rules + indexes + Storage rules. **Re-run after every update of this project.** Wait until all indexes show *Enabled* (Firebase console → Firestore → Indexes).
2. Create the first Super Admin with `npm run create-admin` (or `/setup`), then **turn off public sign-up**: Firebase console → Authentication → Settings → *User actions* → untick **Enable create (sign-up)**. Staff logins are created from *Users & Roles*, which uses the Admin SDK and is not affected.
3. Storage CORS (receipt images in PDFs): put your real domain(s) in `cors.json`, then `gsutil cors set cors.json gs://<your-bucket>`.
4. Authentication → Settings → *Authorized domains*: add your production domain.
5. Settings → Trust profile: check name, address, registration / 80G / 12A numbers, receipt prefix; upload signature & stamp.
6. Settings → *Auto sign-out after idle minutes* (default 30) for shared office PCs.
7. Enable App Check (`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`) and Firestore backups.
8. Take a first backup (Settings → Backup) and keep it offline.

### Security model (summary)

* Every balance / donor / fund total change must be accompanied by a ledger line created in the **same** write, for exactly that amount (`accounts.lastTxnId`). Approve / pay / void are bound to their ledger lines.
* Dates, month and FY of every entry must agree with each other and with the FY start/end (no back-dating into closed periods).
* Audit logs and notifications are server-timestamped and schema-checked; audit logs are append-only.
* Custom roles: the permission list is copied onto each user (`users/{uid}.permissions`); rules check it per action. Users, period locks, reopening months, FY / audit finalization and bank-account master data stay with the Super Admin.

---

## 4. Data model (Firestore)

```
settings/trust, settings/bootstrap
users/{uid}                role, active
counters/{key}             receipt_<FY>, voucher_<FY>, donor, payee (atomic numbering)
trustees, donors, beneficiaries (type: beneficiary|vendor|staff|organization|other)
accounts                   type: bank|cash, openingBalance, currentBalance
funds                      received, spent
donationCategories, expenseCategories
donations                  lines[], amount, status, posted, receiptNo, financialYearId, monthKey …
expenses                   lines[], amount, status, posted, voucherNo, financialYearId, monthKey …
transactions               the ledger – one line per account movement (credit = in, debit = out)
bankStatements, statementLines
monthlyClosings/{YYYY-MM}
financialYears/{YYYY-YY}   openingBalances{}, closingBalances{}, assets[], liabilities[], audit{}
documents, auditLogs, serverAuditLogs, notifications, reports
```
Every financial record carries `financialYearId` (e.g. `2026-27`) and `monthKey` (`2026-04`); dates are stored as `YYYY-MM-DD` strings (timezone-safe).

---

## 5. Project structure

```
src/
  app/(panel)/…        all screens (one folder per menu item)
  app/api/admin/users  server route – create / disable staff logins
  components/          AppShell, forms, ExportButtons, DocumentsPanel, AuditHistory, Charts …
  contexts/            AuthContext (login + role), AppDataContext (masters, FY selection)
  services/            business logic: donations, expenses, ledger, closing, reconciliation …
  reports/             report catalogue (35 reports)
  pdf/                 receipt, voucher & report PDFs (@react-pdf/renderer, Hind font)
  lib/                 constants, permissions, formatting, amount-in-words (Hindi + English)
functions/             optional Cloud Functions
firestore.rules, storage.rules, firestore.indexes.json
```

**Hindi in PDFs:** uses the bundled *Hind* font (`public/fonts`) which contains Devanagari **and** Latin digits/₹ in one font – no fallback-font layout issues.

---

## 6. Notes & limits

* Lists load one financial year at a time and filter in the browser – comfortable for tens of thousands of entries per year.
* Statutory formats (Form 10BD, audited Income & Expenditure / Balance Sheet) depend on your trust's registration – the registers and statements here are the source data; finalise formats with your CA.
* Aadhaar: store only where legally appropriate; ID numbers and bank accounts are masked in the UI.
