---
id: workflow-dl-status-flow
title: Demand Letter Status Flow
type: workflow
access_level: authenticated
module_tags:
  - dl
priority: 1
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - module-dl
  - dl-status-flow-reference
keywords:
  - demand letter
  - dl
  - status
  - workflow
source_system: openci
---

## Purpose
Define the standard status progression and step-by-step procedure for demand letter handling, from creation through field visits to final closure.

## Preconditions
- Required client and account fields are complete
- User has access to the demand letter module
- Bank code is correctly assigned

## Status Flow
```
GENERATED → PRINTED → RELEASED TO OIC → RELEASED TO FM → VISITED → DONE / RETURNED / PULLED_OUT
```

## Step-by-Step

### Step 1: Create Demand Letter
1. Open DL module
2. Click "New Demand Letter"
3. Enter client information:
   - Client full name (required)
   - Client ID (if in system)
   - Amount owed (required)
   - Bank code (required)
   - Loan account number (required)
4. Select letter template
5. Review pre-filled content and make edits if needed
6. Click "Generate" button
- **Status becomes: GENERATED**

### Step 2: Print Demand Letter
1. After generation, system shows "Print" option
2. Click "Print" and select printer
3. Use official letterhead paper
4. Print immediately (within 24 hours)
5. File paper copy in client folder
- **Status becomes: PRINTED**

### Step 3: Release to OIC
1. Submit printed copy to Officer in Charge
2. Get OIC signature/approval
3. Update status in system to "RELEASED TO OIC"
4. Attach photo of signed approval

### Step 4: Release to Field Manager
1. OIC forwards to Field Manager
2. FM assigns to field agents
3. Update status to "RELEASED TO FM"
4. Agents receive notification with DL details

### Step 5: Field Visit
1. Agent visits debtor location
2. Provides copy of demand letter
3. Records visit details and outcome
4. Takes photo of debtor interaction (with consent)
5. Updates status to "VISITED"

### Step 6: Close Case
1. After visit, DL moves to final status:
   - **DONE**: Debtor agreed and made payment/arrangement
   - **RETURNED**: Debtor refused or not available
   - **PULLED_OUT**: Case closed per bank request
2. Add notes explaining final outcome
3. Archive case if DONE
4. Create follow-up task if debt still pending

> **WARNING:** Do not skip workflow statuses or close a case with an incorrect final state, because this creates audit and operations inconsistencies.

## Failure Handling
- If required fields are missing, do not advance status
- If workflow order is violated, correct to the previous valid status
- Escalate unresolved status conflicts to operations support
- Return reason codes are mandatory for RETURNED status
