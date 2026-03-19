---
id: module-ci
title: Credit Investigation Module
type: module
access_level: authenticated
module_tags:
  - ci
priority: 1
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - workflow-dl-status-flow
  - faq-banks
  - banks-supported
keywords:
  - credit investigation
  - client profile
  - ci
  - credit score
  - financial documentation
source_system: openci
---

## Overview
The Credit Investigation (CI) module is used for conducting comprehensive credit investigations on clients. It includes gathering financial information, assessing creditworthiness, and analyzing payment history.

## Core Capabilities
- Client profile creation and management
- Credit score tracking and updates
- Financial documentation upload and storage
- Automated credit analysis reports
- Bank integration for real-time credit data
- Historical credit tracking
- Credit data review and case context tracking
- Documentation support for downstream collections

## Supported Banks
TFS, SBF, CBS, BDO, BPI, CSB, ESQ, EWB, FHL, FUSE, HOME CREDIT, HSBC, PNB, RSB, RCBC, PSB, UBP, MANULIFE, MAYA, MBTC, MSB, TALA, AUB

> **NOTE:** All banks can use the CI module for credit assessment and client profiling.

## Constraints
- Access is limited to authenticated users
- Data entry must follow platform validation requirements
- Credit scores must be verified before generating reports

> **IMPORTANT:** Only authenticated users should process CI module actions, and required validation must be completed before submission.

## Related Workflows
- Demand letter generation and status progression
- Form Builder for custom CI data collection
