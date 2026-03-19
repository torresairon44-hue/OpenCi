---
id: faq-tagging
title: Location Tagging and GPS FAQ
type: faq
access_level: authenticated
module_tags:
  - sc
  - workforce
priority: 1
owner: openci-operations
version: 1.0.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - module-skip-collect
  - module-workforce
  - troubleshoot-gps-location
keywords:
  - tagging
  - gps
  - location
  - mandatory tagging
  - visibility
source_system: openci
---

## Question
What is mandatory tagging and how does GPS location work in OpenCI?

## Answer
Every field activity (visit, contact, skip trace) must have a GPS location tag attached. This is a mandatory compliance requirement.

### Key Questions and Answers

**What is mandatory tagging?**
Every activity must be GPS-tagged at the time it occurs. VRP/OSRM cannot replace this requirement.

**What if I cannot get a GPS signal in an area?**
If GPS is unavailable, you cannot tag the activity. Escalate to your Area Coordinator for approval to proceed without tagging.

**Can I tag location manually instead of GPS?**
No. All tagging must be GPS-verified. Manual entry is not accepted by the system.

**What does "Visibility Issues = No Tagging" mean?**
If the system cannot verify your location due to terrain, dense vegetation, or buildings blocking the GPS signal, tagging will fail. Contact your Area Coordinator for next steps.

**How accurate does GPS need to be?**
GPS must be within 100 feet (approximately 30 meters) of your actual location for valid tagging.

> **IMPORTANT:** VRP/OSRM are NOT active substitutes for GPS tagging. Agents must ensure GPS is enabled and permissions are set to "Always Allow."

> **WARNING:** Failure to tag activities may result in compliance flags visible to supervisors and Area Coordinators.

## Related Topics
- Skip and Collect module
- Workforce Management
- GPS troubleshooting guide
