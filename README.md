# Trust Manager – Donation & Accounting Web Panel

**Next.js 16 + React 19 + Ant Design 6 + PostgreSQL** – runs on your own server (Hostinger VPS), no Firebase.

A complete **Trust Financial Management System**: every rupee is traceable from
*donor → category/purpose → bank/cash account → balance → expense → payee → purpose → document → approver → monthly/yearly totals → audit*.

---

## 1. Features (requirement → where it is)

| # | Requirement | Screen / file |
|---|---|---|
| 3 | Roles: Super Admin, Accountant, Data Entry Operator, Auditor/CA | `src/lib/permissions.js`, `src/server/rpc.js`, **Users & Roles** |
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
| 23 | Documents stored on the server (never deleted – archived) | **Documents** + tab on every record |
| 24, 26 | Approval workflows, no delete – void + automatic reversal entry | `src/server/services/donations.js`, `expenses.js` |
| 25 | Audit trail: user, time, action, old → new value, reason, device | **Audit Logs**, tab on every record |
| 27 | In-app notifications (bell) + scheduled digests | `NotificationBell`, `src/server/jobs.js` |
| 30–31 | Trust master settings, logo/deity images, signature, stamp, trustees | **Settings**, **Trustees** |
| 34 | Security: server-side permission check on every action, period locks, masked bank numbers, append-only logs | `src/server/` |

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

## 2. How it works (architecture)

```
Browser (Next.js pages)  ──►  /api/rpc     every change (approve, pay, void, save …) – permission checked on the server
                         ──►  /api/query   reads: filters / search / sort / paging / sums run inside PostgreSQL
                         ──►  /api/upload  documents & images → saved on the server disk (UPLOAD_DIR)
                         ──►  /api/auth/*  login / logout (httpOnly session cookie)
Next.js server  ──►  PostgreSQL  (one table per record type, money logic in SQL transactions with row locks)
cron (VPS)      ──►  /api/cron/*  monthly report, daily digest, next financial year
```

* **The browser never writes to the database.** All business rules (receipt numbering, posting to the ledger, balances,
  period locks, void + reversal, roles) run on the server in `src/server/` inside one SQL transaction each.
* **Tables:** every table has `id`, `data jsonb`, `created_at`, `updated_at` + indexes on the fields that are filtered /
  sorted (`db/migrations/001_init.sql`). Any filter combination works – no index management needed.
* **Lists:** 100 rows per page; counts, totals and running balances are computed in SQL (fast with lakhs of entries).
* **Logins:** passwords hashed with scrypt; 5 wrong passwords lock the login for 15 minutes; sessions end after
  12 idle hours (and the browser signs out after the idle minutes set in Settings).

---

## 3. Mac par setup (development)

```bash
cd trust-manager-project
bash scripts/setup-mac.sh        # installs Node 22 + PostgreSQL 16 (Homebrew), creates the database, .env.local, tables
npm run dev                      # http://localhost:3000
```
* **New trust:** open `http://localhost:3000/setup` → creates the Super Admin, trust profile, categories, Cash account, current FY.
* **Old Firebase data:** see section 5.
* Locked out? `npm run create-admin` creates a Super Admin or resets its password.
* Table changes in future updates: `npm run db:migrate` (safe to run any time).

### First-day checklist
1. Settings → trust details, 12A/80G numbers, receipt texts, upload images → *Sample receipt* to preview.
2. Bank Accounts → add each bank account with its **opening balance as on 1 April**.
3. Cash Book → check cash opening (set during setup).
4. Funds / Projects (optional) → create restricted funds; link donation categories to a default fund.
5. Users & Roles → add accountant / operator / auditor logins (they choose their own password at first sign-in).

---

## 4. Hostinger VPS par deploy (production)

**Needs:** a Hostinger **VPS** (KVM 1 is enough for one trust; KVM 2 for more users) with **Ubuntu 24.04**, and a
domain / sub-domain (eg. `trust.example.org`). Shared / web hosting does not have PostgreSQL – use a VPS.

1. **DNS:** in your domain panel add an **A record** `trust` → the VPS IP. Wait until `ping trust.example.org` shows the IP.
2. **Push the code to GitHub** (private repo is fine).
3. **Run the setup script on the VPS** – from the Mac (project folder):
   ```bash
   scp deploy/setup-vps.sh root@<VPS-IP>:/root/
   ssh -t root@<VPS-IP> "bash /root/setup-vps.sh trust.example.org you@example.org git@github.com:<you>/<repo>.git"
   ```
   The script installs Node 22, PostgreSQL 16, Nginx, free SSL (Let's Encrypt), PM2, firewall, fail2ban, nightly backups
   and the scheduled jobs. It prints a **deploy key** – add it in GitHub (repo → Settings → Deploy keys, read-only) and
   press Enter; it then clones, builds and starts the app.
4. Open `https://trust.example.org/setup` (new trust) – or first move the Firebase data (section 5).

**Update after code changes:** `git push` on the Mac, then on the VPS
```bash
sudo -u trust bash /var/www/trust-manager/deploy/deploy.sh    # backup → pull → install → migrate → build → restart
```
Without GitHub: `bash deploy/push-from-mac.sh root@<VPS-IP>` from the Mac (rsync + build on the server).

| What | Where (VPS) |
|---|---|
| App | `/var/www/trust-manager` (PM2 process `trust-manager`, port 3000 behind Nginx) |
| Settings / secrets | `/var/www/trust-manager/.env.local` (DB password, CRON_SECRET) |
| Uploaded files | `/var/lib/trust-manager/uploads` |
| Backups (every night 02:30, 30 days) | `/var/backups/trust-manager` + encrypted off-site copy (Google Drive / Backblaze) – see **4.1** |
| Logs | `sudo -u trust pm2 logs trust-manager`, `/var/log/trust-manager/` |
| Restore a backup | `sudo -u trust bash deploy/restore.sh <db_….dump> [files_….tar.gz]` |
| Health check | `https://trust.example.org/api/health` (use it in an uptime monitor) |

### Production go-live checklist
1. Domain opens with **https** (padlock) – SSL is renewed automatically by certbot.
2. Settings → Trust profile: name, address, registration / 80G / 12A numbers, receipt prefix; upload signature & stamp.
3. Settings → *Auto sign-out after idle minutes* (default 30) for shared office PCs.
4. Users & Roles → staff logins; nobody shares the Super Admin login.
5. Check that a backup file appears in `/var/backups/trust-manager` the next morning, and test a restore once.
6. Hostinger hPanel → VPS → **Snapshots / weekly backups** on (extra safety for the whole server).

---

### 4.1 Off-site backup (Google Drive / Backblaze) – zaroor karein

Server kharab ho jaye to server wala backup bhi chala jata hai. Isliye har raat ka backup
**encrypt hokar** bahar bhi jata hai (rclone + gpg AES-256). Ek baar setup:

1. **Mac par** (Google Drive ke liye): `brew install rclone` → `rclone authorize "drive"` → browser me login →
   terminal me jo lamba token aaye use copy kar lo.
2. **VPS par** (`trust` user):
   ```bash
   sudo -u trust rclone config        # n → name: gdrive → storage: drive → client id/secret khali →
                                       # scope 1 → "Use web browser?" = n → Mac wala token paste → team drive n
   sudo -u trust rclone mkdir gdrive:trust-backups
   ```
   (Backblaze B2 / S3 bhi chalega – `rclone config` me wo storage chuno.)
3. `/var/www/trust-manager/.env.local` me jodo:
   ```
   BACKUP_REMOTE=gdrive:trust-backups
   BACKUP_PASSPHRASE='ek lamba password jo kahin likh kar safe rakho'
   # REMOTE_KEEP_DAYS=90
   ```
   ⚠️ Passphrase kho gaya to off-site backup khul nahi sakega – ise trust ke 2 logon ke paas likhit rakho.
4. Test: `sudo -u trust bash deploy/backup.sh` → last line `off-site ok: …` aani chahiye.
5. Wapas laana (naye server par bhi): `sudo -u trust bash deploy/restore-offsite.sh` (list) →
   `… restore-offsite.sh 2026-11-17_0230` (download + decrypt) → phir jo command print ho (`deploy/restore.sh …`).

### 4.2 Email / WhatsApp messages (Settings → Messages)

**Email (free):** Gmail → Google account → 2-Step Verification ON → "App passwords" → ek password banao.
Settings → Messages → Email ON, SMTP `smtp.gmail.com`, port `587`, login = Gmail id, password = App password → Save → "Send a test".
(Hostinger mail: `smtp.hostinger.com`, port `465` + SSL ON.)

**WhatsApp (Meta WhatsApp Cloud API):**
1. business.facebook.com → WhatsApp → phone number add karo → *Phone number ID* aur *permanent access token* (System user token) lo.
2. Message templates banao aur approve karao (category *Utility*, language Hindi = `hi`):
   | Template name | Header | Body parameters |
   |---|---|---|
   | `donation_receipt` | **Document** | {{1}} donor name, {{2}} amount, {{3}} receipt no. |
   | `donor_greeting` | – | {{1}} name, {{2}} occasion (जन्मदिन / वर्षगाँठ), {{3}} trust name |
   | `pledge_reminder` | – | {{1}} name, {{2}} amount, {{3}} due date, {{4}} trust name |
   | `login_otp` (Authentication) | – | {{1}} OTP (donor portal) |
3. Settings → Messages → WhatsApp ON, Phone number ID + token daalo → Save → test.

Password / token database ki alag table (`app_secrets`) me rehte hain – staff ko settings me nahi dikhte.
Auto receipt, janmdin / anniversary wishes (roz 8:30) aur sankalp reminder (roz 9:40) cron se chalte hain
(`deploy/setup-vps.sh` me jud chuke hain; purane server par `/etc/cron.d/trust-manager` me ye 2 lines jodo:
`special-days`, `pledge-reminders`). Har message ka record Settings → Messages → "Recent messages" me.

### 4.3 Online donation (Razorpay) + Donor portal

- **Donation page:** `https://<domain>/donate` – UPI / card / net-banking. Payment hote hi approved receipt banti hai aur
  (Messages ON ho to) donor ko email / WhatsApp par chali jaati hai. Settings → **Online donation** me Razorpay Key ID,
  Key Secret, Webhook secret aur bank account chuno. Razorpay Dashboard → Webhooks → URL
  `https://<domain>/api/public/razorpay/webhook` (events: payment.captured, order.paid, payment.failed).
  Menu → **Online donations** me har payment ka status; "Paid – receipt NOT made" par *Retry*.
- **Donor portal:** `https://<domain>/portal` – donor mobile (WhatsApp OTP, template `login_otp`) ya email OTP se login karke
  apni receipts, saal ka 80G statement PDF aur sankalp dekhta hai, email / PAN / pata khud update kar sakta hai (audit log me "Donor portal").

### 4.4 Security, monitoring, tests

- **2-step login:** naam ke menu → "2-step login" → Google/Microsoft Authenticator se QR scan → code. 8 recovery codes milte hain
  (phone kho jaye to). Settings → **Security** me role tick karke compulsory bana sakte ho. Phone kho gaya: Users & Roles → "…" →
  *Reset 2-step login*.
- **System health** (Super Admin menu): database, disk, last backup, server/browser errors ka log. Nayi server error par email
  (System health → email). Bahar se uptime check: uptimerobot.com (free) → HTTP monitor → `https://<domain>/api/health`.
- **Tests:** `npm test` (business rules – money, FY, TOTP, receipt …), `npm run test:smoke -- --url https://<domain>`
  (live server par read-only check; demo par `--write` bhi). GitHub par push karte hi `.github/workflows/ci.yml` sab chalata hai
  (build + migrations + demo data + smoke test).

### 4.5 Naye modules (menu → "Temple & services", "Expenses")

| Module | Kya karta hai | Hisaab me kaise jata hai |
|---|---|---|
| **Seva / pooja booking** | seva list + rate + daily limit, booking, pujari ke liye din ki list print | payment = normal **donation receipt** (seva ka category) |
| **Hall / room booking** | calendar, double-booking blocked, rent + deposit, deposit refund | rent / deposit = *Other income* entry, refund = *Adjustment* (cash / bank book) |
| **Store / inventory** | items, purchase / वस्तु दान / issue / wastage / count correction, low-stock alert, stock register | sirf quantity – kharid ka paisa Expenses se |
| **Asset register** | asset no., category, WDV / SLM depreciation, FY-wise opening → closing, CSV for audit | report (books me entry nahi) |
| **Staff & salary** | staff master, monthly sheet (days, bonus, advance), payslip PDF (2 per A4) | "Pay" = har person ka **expense voucher** (create → approve → pay) |

### 4.6 Kai sansthaon ko bechna (multi-sanstha / SaaS) + Owner control panel

Ek hi VPS par ek hi app se kai sansthaen chal sakti hain. **Har sanstha ka apna alag database** hota hai
(`tm_<shortname>`), apna web address (`shortname.aapkabrand.in` ya unka apna domain) aur apni uploads folder.
Ek update (`deploy.sh`) sab sansthaon par ek saath lagta hai.

**Owner control panel** (`https://admin.aapkabrand.in`) – sirf aapke liye (alag login):

| Screen | Kya hota hai |
|---|---|
| Dashboard | Kul sansthaen, active, 15 din me expire, expired, is mahine / is FY ki kamai, renewal due list (WhatsApp reminder button) |
| Sansthaen | Nayi sanstha banayein (database + setup + Super Admin login ek click me, ek-baar ka password), list, search |
| Sanstha detail | Plan, features (add-on on/off), user limit, special price, expiry, grace, trial, domains, suspend / resume, usage (users, entries, DB size), payments |
| Payment received | Paisa mila → amount, UPI / cash / cheque, kitne mahine → expiry apne aap aage badhti hai, receipt no. `SUB/2026-27/0001` |
| Plans & pricing | Basic / Standard / Premium (ya apne plan) – saal / mahine ki keemat, kaunse features, kitne users |
| Settings | Aapka brand, support mobile / email (sanstha ke banner par dikhte hain), warning days, grace days, **aapka Razorpay** (online renewal) |
| Activity log | Aapne kab kya badla |

**Expiry ka niyam:** expiry se 15 din pehle banner → expiry ke baad 7 din grace (sab chalta hai, laal banner) →
uske baad **read-only** (sab dekh / print / download kar sakte hain, nayi entry band) → renew karte hi turant chalu.
Data kabhi delete nahi hota. "Suspend" = login hi band (sirf aap karte hain). Grace ke andar renew → nayi avadhi
purani expiry se judti hai; baad me → aaj se.

**Sanstha ki taraf:** Super Admin ko menu me **Administration → Plan & billing** – plan, features, expiry, payment
history aur **Renew / upgrade** (aapke Razorpay se online). Plan me jo module nahi hai uska menu chhup jata hai
aur page par "aapke plan me nahi hai" aata hai; server bhi us module ka har action rok deta hai.

**Hostinger par setup (pehle se chal rahe VPS ko badalna):**
1. hPanel → Domains → `aapkabrand.in` → DNS: `A  *  <VPS-IP>` (aur `A @ <VPS-IP>`).
2. VPS par: `sudo bash /var/www/trust-manager/deploy/setup-saas.sh aapkabrand.in admin.aapkabrand.in you@gmail.com shawlaji`
   (Caddy lagata hai – har address ka HTTPS apne aap; control DB banata hai; `.env.local` me
   `CONTROL_DATABASE_URL`, `CONTROL_HOST`, `TENANT_BASE_DOMAIN` jodta hai; purani uploads `uploads/shawlaji` me).
3. Owner login: `sudo -u trust bash -c 'cd /var/www/trust-manager && npm run control:owner'`
4. `https://admin.aapkabrand.in` → Sansthaen → New sanstha → short name `shawlaji`, **Database already exists** = `trust`,
   "Own domain" me unka purana address (jaise `trust.example.org`) taaki wo bhi chalta rahe.
5. Nayi sanstha: New sanstha → naam, short name, plan, trial / mahine, Super Admin email → Create → jo login + password
   dikhe use WhatsApp kar dein (pehli baar login par naya password banana padta hai).
6. Sanstha apna domain chahe: unke DNS me `A <domain> <VPS-IP>` → sanstha detail → Own domains me jod dein.
7. Online renewal: Razorpay dashboard → Webhook `https://admin.aapkabrand.in/api/license/webhook`
   (payment.captured, order.paid) → Control panel → Settings me Key ID / secret / webhook secret.

**Kitni sansthaen ek VPS par?** RAM ki zarurat sanstha badhne se zyada nahi badhti (ek hi Node process). KVM 2 (8 GB)
par aaram se 30–50 chhoti-madhyam sansthaen. Sanstha 25 se zyada ho to `/etc/postgresql/16/main/postgresql.conf` me
`max_connections = 200` karein (har sanstha max `TENANT_POOL_MAX`=3 connection).

**Backup:** `deploy/backup.sh` control DB + har sanstha ki alag dump banata hai (`db_<shortname>_<date>.dump`).
Ek sanstha restore: `pg_restore --clean --no-owner -d tm_<shortname> db_<shortname>_<date>.dump`.

**Bina control panel ke (sirf ek trust):** `CONTROL_DATABASE_URL` na rakhein – sab pehle jaisa, koi expiry nahi.

## 5. Firebase se data laana (one-time migration)

Everything – donations, expenses, ledger, donors, users, settings, counters (receipt numbers continue), audit trail,
uploaded documents and images – is copied from Firebase into PostgreSQL. **Firebase is only read, nothing is deleted there.**

1. Firebase console → Project settings → **Service accounts** → *Generate new private key* → save as `service-account.json`
   in the project folder (it is in `.gitignore` – never commit it).
2. *(So that staff keep their passwords)* Firebase console → **Authentication → Users → ⋮ (top right) → Password hash
   parameters** → copy the text into `hash-config.txt`. Without this file every login gets a temporary password
   (written to `migration-temp-passwords.csv`; each user chooses a new password at first sign-in).
3. Stop data entry in the old app, then run (on the Mac against the local database, or on the VPS in `/var/www/trust-manager`):
   ```bash
   npm run migrate:firebase -- --key ./service-account.json --hash-config ./hash-config.txt
   ```
   It prints the number of records per type, downloads the files and checks that every account balance = opening + ledger.
   Re-run with `--force` to replace the data again (eg. a final run on go-live day).
4. Moving the local (Mac) database to the VPS instead of migrating there:
   ```bash
   pg_dump --no-owner -Fc postgres://trust:trust@localhost/trust > trust.dump && scp trust.dump root@<VPS-IP>:/tmp/
   scp -r uploads/* root@<VPS-IP>:/var/lib/trust-manager/uploads/      # then on the VPS: chown -R trust:trust /var/lib/trust-manager
   # on the VPS:  sudo -u trust bash /var/www/trust-manager/deploy/restore.sh /tmp/trust.dump
   ```
5. Delete `service-account.json`, `hash-config.txt` and `migration-temp-passwords.csv` afterwards. When everything is
   checked, the Firebase project can be deleted (keep a last Settings → Backup Excel file first).

---

## 6. Data model

```
settings/trust, settings/bootstrap
users                      role, active (passwords: user_credentials – separate table, never sent to the browser)
counters/{key}             receipt_<FY>, voucher_<FY>, donor, payee (atomic numbering, row-locked)
trustees, donors, beneficiaries (type: beneficiary|vendor|staff|organization|other)
accounts                   type: bank|cash, openingBalance, currentBalance
funds                      received, spent
donation_categories, expense_categories
donations                  lines[], amount, status, posted, receiptNo, financialYearId, monthKey …
expenses                   lines[], amount, status, posted, voucherNo, financialYearId, monthKey …
transactions               the ledger – one line per account movement (credit = in, debit = out)
bank_statements, statement_lines
monthly_closings/{YYYY-MM}
financial_years/{YYYY-YY}  openingBalances{}, closingBalances{}, assets[], liabilities[], audit{}
stats/fy_<FY>              year summary for dashboard / closing (updated in the same transaction as every posting)
documents, audit_logs, notifications, reports, roles
sessions, user_credentials, schema_migrations
```
Every financial record carries `financialYearId` (eg. `2026-27`) and `monthKey` (`2026-04`); dates are `YYYY-MM-DD`
strings, timestamps ISO-8601 strings.

---

## 7. Project structure

```
src/
  app/(panel)/…        all screens (one folder per menu item)
  app/api/             rpc, query, upload, files, auth, setup, cron, health
  server/              SERVER ONLY: PostgreSQL store + SQL, auth/sessions, permissions, actions (rpc.js), jobs, services/
  services/            browser side: small functions that call the server (same names as before)
  components/          AppShell, forms, ExportButtons, DocumentsPanel, AuditHistory, Charts …
  contexts/            AuthContext (login + role), AppDataContext (masters, FY selection)
  reports/             report catalogue (35 reports)
  pdf/                 receipt, voucher & report PDFs (@react-pdf/renderer, Hind font)
  lib/                 constants, permissions, formatting, amount-in-words, query helpers (q.js), api.js
db/migrations/         SQL schema (applied by npm run db:migrate)
deploy/                VPS setup, deploy, backup, restore, nginx
scripts/               setup-mac.sh, db-migrate, create-super-admin, migrate-from-firebase, i18n-check
```

**Hindi in PDFs:** uses the bundled *Hind* font (`public/fonts`) which contains Devanagari **and** Latin digits/₹ in one font.

---

## 8. Notes & limits

* Statutory formats (Form 10BD, audited Income & Expenditure / Balance Sheet) depend on your trust's registration – the
  registers and statements here are the source data; finalise formats with your CA.
* Aadhaar: store only where legally appropriate; ID numbers and bank accounts are masked in the UI.
* There is no e-mail service: forgotten passwords are reset by the Super Admin (Users & Roles → Reset password).
