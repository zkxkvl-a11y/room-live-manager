# ROOM LIVE — secure V2 cutover (NOT YET DEPLOYED)

This repository includes a staged V2 client, RTDB rules, migration script, and Cloud Functions.
**Pushing GitHub code does not deploy RTDB rules or Functions.** Do not publish `database.rules.json` until all steps below are ready. Workers lose legacy `/roomLive` access under the new rules.

## Prerequisites
- Firebase project `room-live-manager`; RTDB instance `room-live-manager-default-rtdb` in `asia-southeast1`.
- A Firebase plan that supports Cloud Functions deployment (Blaze billing may be required).
- Authorized Firebase CLI login and an Admin SDK credential/ADC on the migration machine. Never commit keys.
- Scheduled maintenance window: stop ALL legacy app writes and close every legacy app tab.
- Verify GitHub Actions build and tests, and make a separate full RTDB backup first.

## Deployment
1. Install dependencies: `npm install`, `npm --prefix functions install`, and Firebase CLI.
2. Deploy backend first: `firebase deploy --only functions --project room-live-manager`. Verify `processCheckout` and `publishObserver` exist and run.
3. With legacy writes stopped, back up the database. Then run `node scripts/migrate-v2.cjs` with Admin SDK credentials and correct project. Existing V2 staging will cause a safe abort; inspect/backup staging and, only if authorized, use `node scripts/migrate-v2.cjs --replace-staging`. The script preserves the original and old staging under `/roomLiveLedgerMigration/v2CutoverBackup` before replacement. Check payment count and amount against legacy.
4. Test new rules with Firebase Emulator Suite against admin, worker, observer, and unapproved identities. Rules must deny worker `/roomLive`, `/roomLiveV2/finance`, and parent `/roomLiveV2` reads; allow worker operations and own checkout requests.
5. During the same maintenance window, publish `database.rules.json` in Realtime Database > Rules (or `firebase deploy --only database --project room-live-manager`). Then set `/roomLiveV2/config/active` to Boolean `true` in the Firebase Console. **This sequence has a short planned worker outage between rule publication and activation.**
6. Sign out and back in on each device. Test room start, time changes, attendance, concurrent checkout, ledger corrections, observer view, and revoked-user denial.
7. Keep legacy backup read-only. Do not delete legacy data until reconciled.

## Rollback
If verification fails, stop writes and preserve the V2 state before reverting. Do NOT simply turn off `config.active` while worker legacy access is blocked: that would strand worker clients. Roll back app mode and rules together during maintenance, and reconcile payments processed in V2 before restoring legacy writes. Rolling back old permissive rules temporarily restores staff access to the full legacy ledger; assess that privacy risk.

## Current limitations
- Operations remains one worker-writable RTDB subtree. Fine-grained field-level permissions and stronger server validation of non-financial operational edits are future hardening work.
- Finance corrections use finance-only transactions; historical finance-related logs are excluded from worker operations, and correction metadata is retained on payments.
- Cloud Functions require deployment and live validation. Code and static tests alone do not prove secure production operation.
- The migration is not zero-downtime; legacy writes must be stopped to prevent lost changes.
