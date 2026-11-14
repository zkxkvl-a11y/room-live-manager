# ROOM LIVE integrated recovery plan — 2026-11-15

## Baselines
- Feature baseline: patch/multi-user-mvp @ 73dbca20419eec4dad7700dba6250d2719c58581
- Separate production branch: main @ 767e290eb4f0d7980cd6f5a689e94844d7f11208
- Recovery branch: recovery/room-live-integrated-20261115
- The two histories diverged at 2c5a8274e0d21c16530ed41c911ef066a5a38e50. Do not fast-forward, force-push, or blindly merge.

## Product acceptance criteria
1. Restore latest room board, attendance, operator and observer workflows, room timer controls, room-run history and cleaning-wait transitions.
2. Hide/disable legacy ledger, checkout and payment entry points in the operational UI, preserving all stored records. Check that server-side finance permissions are not weakened.
3. Preserve Firebase Realtime Database production data and role boundaries; no destructive migration.
4. Consolidate notification delivery after reviewing both implementations. Validate permission, service worker, per-device subscription, authenticated registration, cron/scheduler, deduplication and push receipt on supported installed PWAs.
5. Verify TypeScript/Vite build, automated checks, live multi-user sync, room finish, cleaning reset, and background notifications.
6. Publish only after a verified production build and explicit comparison of deployed commit, version manifest and UI. Keep rollback commit available.

## Integration sequence
- Audit both branches' App.tsx, store-model, Firebase functions, service workers, notification worker and deployment configuration.
- Keep this branch as immutable feature baseline until audit is complete. Implement integration on a subsequent working branch if needed.
- Cherry-pick or port only compatible production push changes, not entire divergent main history.
- Validate in preview before changing Cloudflare production branch or merging to main.
- Verify production branch setting, production commit and live URL after deployment.

## Safety gates
- Never overwrite/delete RTDB data or remove finance records.
- Never expose private keys, Firebase service-account secrets, VAPID private key or admin UID.
- Stop if a migration, permission rule or push subscription schema is ambiguous.
- Build success alone is not evidence of end-to-end device notification success.
