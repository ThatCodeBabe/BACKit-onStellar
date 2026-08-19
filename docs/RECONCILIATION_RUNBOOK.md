# BACKit On-Chain Portfolio Reconciliation & Indexer Repair Runbook

This runbook outlines the operational workflow for quantifying off-chain database drift, performing dry-run evaluations, executing automated idempotent database repairs, and handling unrecoverable discrepancies.

---

## Overview

BACKit uses PostgreSQL as its frontend read model and Soroban RPC contract events as the source of truth for on-chain prediction market state. Due to RPC interruptions, network re-orgs, indexer lag, or parsing errors, state drift can occur between Soroban events and PostgreSQL (`calls`, `stakes`, `payout_claims`).

The **Reconciliation Service** compares indexed event activity against PostgreSQL records for a given ledger range (`fromLedger` to `toLedger`) without submitting any Soroban transactions.

---

## 1. Safety & Guarantees

1. **Zero On-Chain Mutations**: Reconciliation **NEVER** submits transactions to the Stellar network or alters smart contract state.
2. **Distributed Locking**: Only one active reconciliation job is permitted per network (`testnet`, `mainnet`) at any time.
3. **Idempotency**: Re-running reconciliation over the same ledger range creates no duplicate records and triggers no duplicate user notifications.
4. **Dry-Run Default**: All reconciliation runs default to `isDryRun: true`.
5. **Quarantine Protection**: Unsafe mismatches (`UNRECOVERABLE`, corrupted data, conflicting states) are quarantined in `reconciliation_discrepancies` for admin investigation.

---

## 2. Discrepancy Classification

Discrepancies are categorized into 5 distinct types:

| Discrepancy Type     | Description                                                                                                        | Repair Strategy                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `MISSING_OFFCHAIN`   | On-chain event exists in Soroban RPC / event log, but record is absent in PostgreSQL.                              | Transactionally upserts missing record into `calls`, `stakes`, or `payout_claims`. |
| `DUPLICATE_OFFCHAIN` | Multiple PostgreSQL records found matching a single stable event identity (`contractId:ledger:txHash:eventIndex`). | Quarantined for manual operator review.                                            |
| `VALUE_MISMATCH`     | Record exists off-chain, but amounts, status, or addresses differ from on-chain event.                             | Simple status updates are auto-repaired; complex value conflicts are quarantined.  |
| `UNKNOWN_CONTRACT`   | Event emitted by a contract ID not included in the configured BACKit deployment set.                               | Quarantined.                                                                       |
| `UNRECOVERABLE`      | Event payload is unparseable or data is corrupted.                                                                 | Quarantined for developer / admin triage.                                          |

---

## 3. Operator Execution Workflow

### Step 1: Execute Dry-Run Evaluation

Before running repair mode, perform a dry-run to generate a structured discrepancy report:

```bash
POST /admin/reconciliation/run
Header: Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "network": "testnet",
  "fromLedger": 100000,
  "toLedger": 105000,
  "isDryRun": true
}
```

Response:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "network": "testnet",
  "contractIds": ["CC..."],
  "fromLedger": 100000,
  "toLedger": 105000,
  "isDryRun": true,
  "status": "PENDING"
}
```

### Step 2: Inspect Run Progress & Discrepancies

Check run status:

```bash
GET /admin/reconciliation/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

List detected discrepancies:

```bash
GET /admin/reconciliation/discrepancies?runId=a1b2c3d4-e5f6-7890-abcd-ef1234567890&limit=50
```

Review `scannedEventsCount`, `discrepancyCount`, and `discrepancyBreakdown`.

### Step 3: Execute Repair Mode

Once the dry-run report is reviewed and verified by an operator, execute repair mode over the target range:

```bash
POST /admin/reconciliation/run
Header: Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "network": "testnet",
  "fromLedger": 100000,
  "toLedger": 105000,
  "isDryRun": false
}
```

Repair mode will:

- Upsert missing `Call`, `Stake`, and `PayoutClaim` records in PostgreSQL.
- Mark auto-repaired items as `REPAIRED`.
- Quarantine unsafe items as `QUARANTINED`.

### Step 4: Re-Verify via Dry-Run

Re-run the same range in dry-run mode:

```bash
POST /admin/reconciliation/run
{
  "network": "testnet",
  "fromLedger": 100000,
  "toLedger": 105000,
  "isDryRun": true
}
```

Verify that `discrepancyCount` for `MISSING_OFFCHAIN` is now `0`.

---

## 4. Incident Response & Rollback Procedures

1. **Overlapping Lock Conflict**: If a run fails unexpectedly and leaves a stale lock key, clear the Redis lock key:
   ```bash
   redis-cli DEL reconciliation_lock:testnet
   ```
2. **Quarantined Discrepancies**: Query all `QUARANTINED` records:
   ```bash
   GET /admin/reconciliation/discrepancies?status=QUARANTINED
   ```
   Investigate cause (e.g. database constraint error or contract redeployment).
3. **Database Transaction Safety**: All repairs execute within TypeORM database transactions (`entityManager.transaction(...)`). If a database error occurs during repair, the entire transaction rolls back cleanly.

---
