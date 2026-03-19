---
id: module-dl
title: Demand Letter Module
type: module
access_level: authenticated
module_tags:
  - dl
priority: 1
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - workflow-dl-status-flow
  - dl-status-flow-reference
keywords:
  - demand letter
  - dl
  - status flow
  - smart assign
  - osrm
source_system: openci
---

## Overview
The Demand Letter (DL) module automates the creation, printing, and tracking of demand letters for debt collection. It manages the full lifecycle from generation to closure.

## Core Capabilities
- Demand letter creation with required client fields
- End-to-end status progression tracking
- Visit outcome capture and final closure state handling
- Smart Assign using OSRM (Open Source Routing Machine) for proximity-based agent assignment
- Retag Printer for batch printing management
- Photo documentation on successful visits

## Workflow Status Flow
```
GENERATED → PRINTED → RELEASED TO OIC → RELEASED TO FM → VISITED → DONE / RETURNED / PULLED_OUT
```

| Status | Description |
|--------|-------------|
| GENERATED | Letter created in system with client information |
| PRINTED | Physical letter printed and ready for distribution |
| RELEASED TO OIC | Handed to Officer in Charge for processing |
| RELEASED TO FM | Forwarded to Field Manager for assignment |
| VISITED | Field agent completed visit to debtor location |
| DONE | Debtor agreed and made payment/arrangement |
| RETURNED | Debtor refused or not available |
| PULLED_OUT | Case closed per bank request |

## Critical Rules
- All required fields must be filled before generating
- Physical copies must be printed within 24 hours of generation
- Status updates must be sequential (cannot skip steps)
- Successful visits must include photo documentation
- Return reason codes are mandatory for RETURNED status

> **IMPORTANT:** Statuses must be updated sequentially to keep audit and operational records valid.

> **WARNING:** Skipping statuses or closing in the wrong final state can invalidate case tracking and reporting.

## Related Workflows
- Demand letter status flow
- Field visit and closure workflow
- DL status flow reference guide
