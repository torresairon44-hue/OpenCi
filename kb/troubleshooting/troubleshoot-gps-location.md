---
id: troubleshoot-gps-location
title: GPS and Location Troubleshooting
type: troubleshooting
access_level: public
module_tags:
  - sc
  - workforce
priority: 2
owner: openci-support
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - workflow-field-checkin
  - faq-tagging
  - core-troubleshooting-reference
keywords:
  - gps
  - location
  - stale map
  - permissions
source_system: openci
---

## Symptoms
- Map location is stale or missing
- Location tagging fails during activity updates
- GPS position inaccurate or jumping

## Probable Causes
- Location permission is not set to "Always Allow"
- Internet connectivity is unstable
- GPS signal quality is low (indoors, dense buildings)
- App location services need restart

## Resolution Steps

### Step 1: Check Device Location Permissions
- Settings > Apps > ChatAI > Permissions > Location
- Change to "Always Allow" (not "Only While Using App")

### Step 2: Verify GPS Is Enabled
- Settings > Location > Make sure "Location" toggle is ON

### Step 3: Improve GPS Signal
- Go outdoors away from buildings
- Wait 2-3 minutes for initial GPS lock
- GPS works better with clear sky view

### Step 4: Check Internet Connection
- GPS needs internet to verify location
- Mobile data must be ON or WiFi must be connected
- Check WiFi/signal strength indicator

### Step 5: Restart Location Services
- Go to Settings > Location > Toggle OFF then ON
- Restart the ChatAI app after this

> **NOTE:** Most repeated GPS failures come from location permission set to "while using app" instead of "Always Allow."

### If Issue Persists
- Uninstall and reinstall the app
- Factory reset location services
- Contact IT with device model and Android version

## Escalation Path
- If issue persists after steps above, escalate to Area Coordinator or IT support with device details and timestamp of failure

> **WARNING:** Escalate immediately if tagging is blocked during active field operations to avoid compliance gaps.
