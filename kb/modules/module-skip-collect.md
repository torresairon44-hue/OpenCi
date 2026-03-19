---
id: module-skip-collect
title: Skip and Collect Module
type: module
access_level: authenticated
module_tags:
  - sc
priority: 1
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - workflow-field-checkin
  - troubleshoot-gps-location
  - faq-tagging
keywords:
  - skip and collect
  - sc
  - touch point
  - disposition
  - live map
  - skip tracing
source_system: openci
---

## Overview
The Skip and Collect (SC) module manages skip tracing and collection activities for field agents. It tracks agent location, activities, and debtor contact outcomes.

## Core Capabilities
- Activity tracking across driving, skip tracing, touch point, and disposition states
- Live map status visibility for active and stale operations
- Location tagging support for field compliance
- GPS-verified field activity logging
- Real-time agent monitoring

## Activity Types

| Activity | Description |
|----------|-------------|
| DRIVING | Agent in transit to debtor location (geo-tracked) |
| SKIP_TRACE | Locating debtor at new address (when address changed) |
| TOUCH_POINT | Initial contact with debtor (call, SMS, visit) |
| DISPOSITION | Final outcome recorded (agreed to pay, refused, unavailable) |

## Live Map Status Indicators

| Color | Status | Meaning |
|-------|--------|---------|
| 🟢 GREEN | Live | Agent actively online with GPS enabled |
| ⚪ GREY | Stale | No activity for >10 minutes |
| 🔵 BLUE | Home/Inactive | Agent logged in but inactive status |

## Location Requirements
- GPS must be enabled at all times during shifts
- Tagging is mandatory for all activities
- VRP/OSRM should NOT be used as alternative for mandatory tagging
- If visibility issues prevent tagging, escalate to Area Coordinator

> **IMPORTANT:** VRP and OSRM are not valid substitutes for mandatory location tagging in field operations.

> **WARNING:** Missing or invalid tagging may invalidate field activity records for compliance and reporting.

## Related Workflows
- Daily field check-in and activity logging
- GPS troubleshooting and escalation handling
