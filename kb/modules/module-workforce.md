---
id: module-workforce
title: Workforce Management Module
type: module
access_level: authenticated
module_tags:
  - workforce
priority: 2
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - workflow-field-checkin
  - operational-hours
keywords:
  - workforce
  - scheduling
  - performance
  - task assignment
  - wfm
source_system: openci
---

## Overview
The Workforce Management (WFM) module manages field agent scheduling, task assignment, and performance tracking.

## Core Capabilities
- Task routing by area and operational context
- Shift timeline tracking and break monitoring
- Agent activity and evidence quality monitoring
- Estimated travel time calculation
- Performance metric dashboards

## Operational Guidelines
- Standard work hours: 8 AM – 5 PM
- Default break: 1 hour (lunch)
- Maximum work-without-break: 4 hours
- "Waiting" status indicates gaps in activity (red flags for supervisor)

## Assignment Rules
- Tasks assigned by area/region to agents
- Agent location affects task routing
- Estimated travel time calculated automatically
- Task priority levels: URGENT, HIGH, NORMAL, LOW

## Performance Metrics
- Tasks completed per day
- Average time per task
- GPS accuracy and tagging compliance
- Photo submission rate and quality

> **NOTE:** Waiting status can indicate operational gaps and should be reviewed for supervisor follow-up.

> **IMPORTANT:** Location and activity records must remain consistent with assigned tasks to preserve operational integrity.

## Related Workflows
- Daily check-in and check-out workflow
- Performance and compliance follow-up
- Operational hours policy
