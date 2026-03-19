---
id: dl-status-flow-reference
title: Demand Letter Status Flow Reference
type: workflow
access_level: authenticated
module_tags:
  - dl
priority: 1
owner: openci-operations
version: 1.0.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - module-dl
  - workflow-dl-status-flow
keywords:
  - demand letter
  - status flow
  - dl workflow
  - smart assign
  - osrm
source_system: openci
---

## Purpose
Quick reference for the complete Demand Letter lifecycle from generation to final disposition, including admin actions available at each stage.

## Preconditions
- User must be authenticated with admin or fieldman role
- DL module must be accessible for the assigned bank
- All required client fields must be populated before generation

## Status Flow

```
GENERATED → PRINTED → RELEASED TO OIC → RELEASED TO FM → VISITED → DONE / RETURNED / PULLED_OUT
```

| Status | Description | Actor |
|--------|-------------|-------|
| GENERATED | Letter created in system with client info | Admin |
| PRINTED | Physical letter printed on official letterhead | Admin |
| RELEASED TO OIC | Handed to Officer in Charge for processing | Admin |
| RELEASED TO FM | Forwarded to Field Manager for agent assignment | OIC |
| VISITED | Field agent completed visit to debtor location | Fieldman |
| DONE | Debtor agreed and made payment or arrangement | Fieldman |
| RETURNED | Debtor refused or was not available | Fieldman |
| PULLED_OUT | Case closed per bank request | Admin |

## Step-by-Step
1. Admin creates a new demand letter with all required client information
2. System generates the letter — status becomes GENERATED
3. Admin prints the letter within 24 hours — status becomes PRINTED
4. Letter is released to OIC with signature — status becomes RELEASED TO OIC
5. OIC forwards to Field Manager — status becomes RELEASED TO FM
6. Field agent visits debtor and records outcome — status becomes VISITED
7. Final status is assigned: DONE, RETURNED, or PULLED_OUT

## Admin Actions
- **Smart Assign**: Uses OSRM (Open Source Routing Machine) to assign letters to fieldmen based on proximity
- **Retag Printer**: Changes printer assignment for batch printing
- **Mark Printed**: Updates status to PRINTED
- **Release OIC/FM**: Tracks physical handover of letters

> **IMPORTANT:** Status updates must be sequential. You cannot skip steps in the workflow.

## Failure Handling
- If a letter cannot be printed within 24 hours, escalate to the supervising admin
- If a field visit fails, the agent must provide a return reason code (mandatory for RETURNED status)
- If a case is pulled out, the admin must document the bank request reference

> **WARNING:** Successful visits must include photo documentation as proof of debtor interaction.
