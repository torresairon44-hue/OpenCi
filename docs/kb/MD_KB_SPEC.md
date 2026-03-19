# Markdown Knowledge Base Specification

## Purpose
This document defines the contract for a markdown-first knowledge base.

## Scope
This specification includes structure and content standards only.
No ingestion runtime changes are included in this specification.

## Source of Truth Rules
1. Markdown files under the kb directory are the source of truth for factual knowledge.
2. Runtime policy and behavior guardrails remain in code.
3. Any factual KB addition must be made in markdown first.

## Folder Structure
- kb/modules
- kb/workflows
- kb/troubleshooting
- kb/policies
- kb/faq
- kb/glossary

## Frontmatter Contract
All KB markdown files must start with YAML frontmatter and include all required fields.

Required fields:
- id: stable unique id, lowercase, kebab-case
- title: human-readable title
- type: one of module, workflow, troubleshooting, policy, faq, glossary
- access_level: one of public, authenticated
- module_tags: list of related module tags, may be empty
- priority: integer 1-5 where 1 is highest priority
- owner: team or role responsible for the content
- version: semantic version string, for example 1.0.0
- status: one of draft, approved, deprecated
- last_reviewed: ISO date (YYYY-MM-DD)

Optional fields:
- related_ids: list of kb ids
- keywords: list of search keywords
- source_system: origin system name

## Body Content Rules
1. Use plain markdown headings and lists.
2. Keep sections concise and task-oriented.
3. Include actionable steps for troubleshooting and workflows.
4. Avoid conflicting instructions with runtime policy.
5. Do not include secrets or credentials.

## Highlighting Rules
Use callout blocks to emphasize critical instructions.

Approved highlight labels:
- NOTE: contextual reminders
- IMPORTANT: mandatory operational rules
- WARNING: risk, impact, or escalation trigger

Standard syntax:
- > **NOTE:** message
- > **IMPORTANT:** message
- > **WARNING:** message

Usage limits:
1. Use at most 1 to 3 highlight blocks per section.
2. Highlight only high-impact lines.
3. Keep non-critical text as normal body content.

Placement guidance:
1. Before irreversible or high-risk steps.
2. Before escalation or policy-sensitive instructions.
3. Near constraints that often cause user errors.

## Naming Rules
1. File name must match id plus .md.
2. Use lowercase kebab-case only.
3. Do not reuse ids across files.

## Required Sections By Type
For module:
- Overview
- Core Capabilities
- Constraints
- Related Workflows

For workflow:
- Purpose
- Preconditions
- Status Flow
- Step-by-Step
- Failure Handling

For troubleshooting:
- Symptoms
- Probable Causes
- Resolution Steps
- Escalation Path

For policy:
- Policy Statement
- Enforcement Scope
- Exceptions
- Violation Handling

For faq:
- Question
- Answer
- Related Topics

For glossary:
- Term
- Definition
- Context

## Quality Checklist
Before approval, verify:
1. Frontmatter validates against contract.
2. access_level is correct.
3. Steps are testable and unambiguous.
4. No duplicate or contradictory content.
5. owner and last_reviewed are populated.

## Versioning and Review
1. Increment patch for wording updates.
2. Increment minor for added sections.
3. Increment major for breaking semantics.
4. Review every 30 to 60 days.

## Change Control
1. Draft content is not eligible for production retrieval.
2. Approved content requires at least one reviewer.
3. Deprecated content must include replacement guidance.

## Example Frontmatter
```yaml
---
id: workflow-dl-status-flow
title: Demand Letter Status Flow
type: workflow
access_level: authenticated
module_tags:
  - dl
priority: 1
owner: openci-operations
version: 1.0.0
status: approved
last_reviewed: 2026-03-18
related_ids:
  - module-dl
keywords:
  - demand letter
  - status flow
source_system: openci
---
```

## Boundary
This specification defines markdown standards for the KB.
