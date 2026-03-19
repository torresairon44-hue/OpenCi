---
id: troubleshoot-app-update
title: App Update Troubleshooting
type: troubleshooting
access_level: public
module_tags:
  - support
priority: 2
owner: openci-support
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - troubleshoot-lark
  - core-troubleshooting-reference
keywords:
  - update
  - play store
  - reinstall
  - force stop
source_system: openci
---

## Symptoms
- Update button is missing in the app store
- Installation fails or hangs during update
- App version does not change after update attempt

## Probable Causes
- App store cache issues
- Low device storage
- Account synchronization issues
- Stale local app process

## Resolution Steps

### Step 1: Manual Uninstall & Reinstall
1. Go to Google Play Store
2. Search for "ChatAI OpenCI"
3. Click "UNINSTALL" button
4. After uninstall, click "INSTALL" button
5. Wait for installation to complete (5-10 minutes)

### Step 2: Clear Play Store Cache
1. Settings > Apps > Google Play Store
2. Click "Storage" > "Clear Cache"
3. Return to Play Store and try install again

### Step 3: Force Stop App
1. Settings > Apps > ChatAI
2. Click "Force Stop"
3. Wait 10 seconds, then open app again

### Step 4: Check Storage Space
1. Settings > Storage > Check available space
2. Need at least 100 MB free for app + cache
3. Delete unused apps if storage is low

### Step 5: Verify Google Account
1. Settings > Accounts > Google > Check if account is active
2. Remove and re-add account if issues persist

> **NOTE:** Use a stable network connection during reinstall to avoid incomplete package downloads.

### If Issue Still Persists
- Contact IT with error code shown in Play Store
- Don't try updating more than 3 times (may lock update)
- Mr. Brann handles severe app update issues

## Escalation Path
- Escalate persistent failures with device model, OS version, and visible error message

> **WARNING:** Repeated blind update retries without diagnostics can trigger lock conditions or delay recovery.
