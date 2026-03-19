---
id: workflow-field-checkin
title: Daily Field Check-In Workflow
type: workflow
access_level: authenticated
module_tags:
  - workforce
  - sc
priority: 1
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - troubleshoot-gps-location
  - operational-hours
  - module-workforce
keywords:
  - check in
  - field
  - activity logging
  - check out
  - break
source_system: openci
---

## Purpose
Define daily field check-in, activity logging, break procedures, and check-out standards for field operations.

## Preconditions
- Device location permission is enabled ("Always Allow")
- User is authenticated and assigned for field operations
- GPS is working and verified

## Status Flow
1. ACTIVE after check-in
2. Activity transitions during shift (DRIVING, SKIP_TRACE, TOUCH_POINT, DISPOSITION)
3. INACTIVE after check-out

## Step-by-Step

### Morning Check-In (8:00 AM)
1. Open ChatAI app
2. Verify GPS is enabled and working
3. Click "Check In" button
4. Accept location permission
5. System logs your starting location
6. Status becomes "ACTIVE"

### During Day (Every 30 Minutes)
1. System auto-logs your location every 30 minutes
2. If GPS signal lost, reconnect to internet
3. Update activity status when changing tasks
4. Available statuses: DRIVING, SKIP_TRACE, TOUCH_POINT, DISPOSITION

### Activity Transitions
- **DRIVING**: Moving between client locations (auto-tagged)
- **SKIP_TRACE**: Searching for client at new address (manual toggle)
- **TOUCH_POINT**: Contacting/meeting client (field work)
- **DISPOSITION**: Recording final outcome (case closure)

### Photo Requirements
- Take real-time photos during field work
- Do NOT batch upload photos later
- Photos must show: agent present, client interaction, location context
- File photos within app immediately
- Keep photo quality high (clear, well-lit)

### Break Procedure
1. Mark break start time in app
2. Take maximum 1 hour break
3. Log break location
4. Mark break end when resuming work
5. Avoid gaps (red flag = suspicious timing)

### Evening Check-Out (5:00 PM)
1. Complete all daily tasks
2. Click "Check Out" button
3. Confirm final location
4. Submit all pending activity reports
5. Status becomes "INACTIVE"

### End-of-Day Reporting
1. Submit summary of day's activities
2. Number of DLs served
3. Number of touch points
4. Cases for follow-up
5. Any incidents or delays to flag

> **IMPORTANT:** Real-time photos and location tagging are mandatory during active field work.

## Failure Handling
- If GPS or tagging fails, perform troubleshooting immediately
- If issue persists, escalate and document impact before continuing

> **WARNING:** Delayed or batch evidence upload can violate operational compliance requirements.
