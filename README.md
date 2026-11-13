# CENTRAL ERP COMMAND — Multi-School ERP Management & Business Intelligence Platform

[![Node.js](https://img.shields.io/badge/Node.js-v24.x-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-SQLite%20(node%3Asqlite)-blue.svg)](https://nodejs.org/api/sqlite.html)
[![Security](https://img.shields.io/badge/Security-HMAC--SHA256%20%2B%20Replay%20Protected-purple.svg)]()
[![Tests](https://img.shields.io/badge/Tests-8%2F8%20Suites%20Passing%20(100%25)-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-Proprietary%20SaaS-orange.svg)]()

A centralized, multi-tenant SaaS business management platform, dynamic billing engine, and remote administration console designed for operators of independent School ERP websites. It connects to dozens or hundreds of distributed School ERP customer installations to monitor telemetry, bill dynamically based on verified student headcount, and execute secure remote service control.

---

## 🌟 Key Features & Innovations

### 1. 🔑 Auto-Generated School ID & Cryptographic Provisioning
* **Automatic Provisioning**: Opening the school onboarding modal instantly provisions a unique **School ID** (`SCH-XXXXX`), public **API Key** (`cc_live_pk_...`), and cryptographic **HMAC Secret Key** (`cc_sec_live_...`).
* **Interactive Tooling**: Includes 1-click clipboard copy buttons, a show/hide toggle for secrets, and a **"Regenerate Keys"** button to issue fresh cryptographic pairs on demand.
* **Ready-to-Deploy Connector Snippet**: Automatically generates a formatted `.env` block ready to paste into the remote School ERP installation.

### 2. 📡 Remote ERP Approval Handshake & Real Census Ingestion
* **Remote Handshake Dispatch**: Enter the school ERP website URL (e.g., `https://myschool.schools-erp.cloud`) and click **"Send Approval Request"**.
* **Zero Dummy Data Guarantee**: The central platform dispatches an encrypted authorization request to the school's ERP connector.
* **Live Census Verification**: Upon administrator authorization, the connector securely pulls and verifies live records:
  * Total enrolled students & active students.
  * Faculty and administrative staff counts.
  * Real daily attendance rate (%).
  * Grade and class-wise distribution breakdown.
* **Audit-Logged Authorization**: Explicit data sharing approval is recorded with cryptographic approval tokens and timestamps.

### 3. 💰 Dynamic Per-Student Pricing & 24-Hour Census Reconciliation
* **Flexible Commercial Pricing**:
  * **Per-Student Rate**: Billed dynamically per enrolled student (e.g., ₹25 / student / month).
  * **Flat Tier Rate**: Traditional tier-based campus pricing.
* **Live Calculation Formula**:
  $$\text{Payable Amount} = \text{Verified Student Census} \times \text{Price per Student / Month} \times \text{Billing Months}$$
* **24-Hour Automatic Synchronization**: Background cron rule (`RULE_24H_STUDENT_CENSUS_CHECK`) automatically queries connected school ERPs every 24 hours, updates census figures, and dynamically recalculates upcoming invoices.
* **On-Demand "Check Students" Button**: School profiles feature a dedicated button to trigger instantaneous student census reconciliation.

### 4. 🛑 Remote ERP Service Control (Command Queue)
* **Secure Pull-Based Architecture**: School ERP connectors poll Central Command for pending orders—no open inbound ports or public IP access required on school servers.
* **Predefined Command Set**:
  * `SUSPEND_SERVICE`: Safely intercepts non-admin logins and displays a branded suspension notice with billing contact information.
  * `REACTIVATE_SERVICE`: Immediately restores standard operational access upon payment receipt.
  * `EXTEND_SUBSCRIPTION`: Adds grace days and updates expiration dates.
  * `UPDATE_MODULES`: Dynamically toggles specific ERP features (admissions, fees, attendance, examinations, transport, library, payroll).
  * `SET_GRACE_PERIOD`: Configures delinquent grace threshold.
* **🛡️ Zero Data Loss Guarantee**: Remote suspension **never** deletes, drops, or alters student, teacher, or financial records. School databases remain 100% intact.

### 5. 📊 Executive SaaS BI Dashboard & Cross-School Analytics
* **Executive Metrics**: Total schools, active subscriptions, suspended schools, trial schools, aggregate students across all schools, and faculty counts.
* **Financial Intelligence**: Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), total collected revenue, and outstanding receivables.
* **Interactive Chart.js Visualizers**: Student distribution across schools, revenue trends, faculty census, and subscription health status.
* **Side-by-Side Comparison Matrix**: Benchmark schools by headcount, staff ratios, attendance, and commercial status with 1-click **Export to CSV**.

### 6. 💳 Centralized Commercial Invoicing & Payment Reconciliation
* **Strict Revenue Isolation**: SaaS subscription billings are strictly separated from schools' internal student tuition collections.
* **Invoicing Engine**: Automatic invoice generation with 18% GST calculation, due dates, and outstanding balances.
* **Payment Ledger**: Record payments with bank wire/RTGS UTR references, UPI transaction IDs, cheques, credit cards, or payment gateways.
* **Automatic Status Reconciliation**: Recording a full payment automatically transitions the school's status to `PAID`.

### 7. 🔐 Centralized Threat Stream & Security Audit Logs
* **Remote Threat Aggregator**: Real-time event log ingestion across all connected ERPs: failed login spikes, brute-force attempts, admin privilege escalations, account lockouts, and suspension triggers.
* **Platform Audit Trail**: Complete immutable log of every operator action taken within Central Command.

---

## 🏗️ Architectural Topology

```
                                ┌────────────────────────────────────────────────────────┐
                                │           CENTRAL ERP COMMAND (SaaS HQ)                │
                                │                                                        │
                                │  - SaaS Executive BI & Cross-School Analytics          │
                                │  - Dynamic Per-Student Pricing & 24h Cron Engine       │
                                │  - Cryptographic Key Generator & Approval Dispatcher   │
                                │  - Predefined Remote Command Queue (Non-destructive)   │
                                │  - REST API Engine (Node.js 24 + native node:sqlite)   │
                                └──────────────────────────┬─────────────────────────────┘
                                                           │
                                      HTTPS REST + HMAC-SHA256 Signed
                                      (X-School-Id, X-Api-Key, Timestamp, X-Signature)
                                                           │
           ┌───────────────────────────────────────────────┼───────────────────────────────────────────────┐
           │                                               │                                               │
           ▼                                               ▼                                               ▼
┌──────────────────────────┐                    ┌──────────────────────────┐                    ┌──────────────────────────┐
│  Springdales ERP         │                    │  Cambridge Academy ERP   │                    │  Delhi Heritage ERP      │
│  - Independent Database  │                    │  - Independent Database  │                    │  - Independent Database  │
│  - Real Students: 850    │                    │  - Real Students: 1,240  │                    │  - Status: SUSPENDED     │
│  - Per-Student: ₹25/mo   │                    │  - Per-Student: ₹30/mo   │                    │  - Service Notice Active │
│  - Connector Bridge      │                    │  - Connector Bridge      │                    │  - School Data Intact    │
└──────────────────────────┘                    └──────────────────────────┘                    └──────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Prerequisites
* **Node.js**: Version 22.5+ or 24+ (uses built-in native `node:sqlite`).
* **OS**: Cross-platform (Windows, Linux, macOS).

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/httpsghsthakur/Web-Work-Studio-.git
cd Web-Work-Studio-

# Install dependencies (development & runtime)
npm install
```

### 3. Initialize Clean Database
```bash
# Initializes clean database with system roles, subscription tiers, and automation rules
npm run seed
```

### 4. Run Automated Test Verification
```bash
# Executes all 8 automated integration, security, financial, and pricing test suites
npm test
```

### 5. Start the Server
```bash
# Start server in production mode
npm start
```
Open **`http://localhost:4000`** in your browser.

---

## 👥 Default Administrator Personas

The database is pre-seeded with 4 administrative accounts to test Role-Based Access Control (RBAC):

| Role | Email | Password | MFA Code | Access Scope |
|---|---|---|---|---|
| **Super Admin** | `admin@centralcommand.io` | `Admin@123456` | `123456` | Full Control (Suspension, Credentials, Financials, All Schools) |
| **Operations** | `ops@centralcommand.io` | `Ops@123456` | `123456` | School Onboarding, Modules, Telemetry, Remote Commands |
| **Finance** | `finance@centralcommand.io` | `Finance@123456` | `123456` | Invoices, Payment Ledger, Dues Tracking, Per-Student Pricing |
| **Auditor** | `auditor@centralcommand.io` | `Audit@123456` | `123456` | Read-only Security Audit, Threat Stream, Compliance |

---

## 🔌 Connecting an Independent School ERP

1. Open Central Command at `http://localhost:4000` and sign in.
2. Click **"+ Register School"** in the top navigation or School Management tab.
3. The modal will **automatically generate** the unique **School ID**, **API Key**, and **HMAC Secret**.
4. Enter the **School ERP Base URL** (e.g. `https://myschool.schools-erp.cloud`).
5. Click **"Send Approval Request"** to dispatch the authorization handshake to the school ERP.
6. The ERP connector authorizes access and returns the live verified student headcount, faculty count, and attendance statistics.
7. Set the **Plan Price Per Student** (e.g., ₹25/student/month). Central Command immediately calculates the payable amount.
8. Click **"Register School & Save Credentials"**.
9. Copy the generated connector configuration snippet into your remote school ERP's `.env` file:
   ```env
   CENTRAL_ERP_URL=http://localhost:4000
   CENTRAL_SCHOOL_ID=SCH-XXXXX
   CENTRAL_API_KEY=cc_live_pk_...
   CENTRAL_HMAC_SECRET=cc_sec_live_...
   ```

---

## 🧪 Automated Test Suite Coverage

| Test Suite | Purpose & Coverage | Status |
|---|---|---|
| `test_auth_rbac.js` | JWT authentication, role restrictions, password hashing, and active user verification | ✅ PASS |
| `test_hmac_security.js` | HMAC-SHA256 signature verification, tampering detection, and replay attack prevention | ✅ PASS |
| `test_tenant_isolation.js` | Strict multi-school isolation ensuring zero cross-tenant data leakage | ✅ PASS |
| `test_remote_control.js` | Predefined command queue, non-destructive suspension, zero data loss, reactivation | ✅ PASS |
| `test_financial_invoicing.js` | Invoicing engine, tax calculations, payment recordings, and auto status transitions | ✅ PASS |
| `test_sync_and_bi.js` | Idempotent telemetry sync and real-time executive BI calculations | ✅ PASS |
| `test_per_student_pricing.js` | Dynamic per-student pricing formula and 24-hour automatic census reconciliation cron | ✅ PASS |
| `test_credentials_and_approval_flow.js` | Auto-generation of credentials, approval handshake dispatch, and real census ingestion | ✅ PASS |
| `test_deep_analytics_and_exports.js` | Real-data analytics hub, financial ledgers, census distributions, and multi-format CSV/JSON exports | ✅ PASS |
| `test_pdf_email_and_due_alerts.js` | Vector PDF tax invoice generation, email dispatch, WhatsApp messaging, and approaching due alerts | ✅ PASS |

---

## 🗄️ Hostinger Database (MySQL / MariaDB) Setup

The platform natively supports **Hostinger MySQL & MariaDB** databases for hosting all platform tables, users, and telemetry data:

1. In your **Hostinger hPanel**:
   - Go to **Databases** $\rightarrow$ **MySQL Databases** $\rightarrow$ Create a new database and username.
   - Go to **Remote MySQL** $\rightarrow$ Add IP `%` (Any host) or your server IP so Central Command can connect remotely.
2. In your `.env` file (copy from `.env.example`):
   ```env
   DB_CLIENT=mysql
   DB_HOST=sqlXXX.hostinger.com    # Provided in Hostinger hPanel
   DB_PORT=3306
   DB_NAME=u123456789_central_erp
   DB_USER=u123456789_admin
   DB_PASSWORD=your_hostinger_password
   ```
3. Run the automated migration utility:
   ```bash
   npm run migrate:hostinger
   ```
   This deploys the 13 relational tables from `src/database/schema.mysql.sql` and copies all local administrators, schools, invoices, and metrics straight to Hostinger!

---

---

## 📚 Technical Documentation

* [API Specification](docs/API_SPECIFICATION.md) — Comprehensive REST API endpoints and request/response payloads.
* [Connector Integration Guide](docs/CONNECTOR_INTEGRATION_GUIDE.md) — Step-by-step instructions for embedding the connector in PHP, Node.js, Python, or Laravel school ERPs.
* [Security Architecture](docs/SECURITY_ARCHITECTURE.md) — Cryptographic standards, HMAC signing specifications, and tenant isolation policies.
* [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) — Production setup with Nginx reverse proxy, SSL/TLS certificates, and PM2 process management.
