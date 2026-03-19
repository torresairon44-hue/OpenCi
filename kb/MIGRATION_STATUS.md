# KB Migration Status

## Overview
This file tracks migration progress from TypeScript KB sources into markdown files.

## Mandatory Format Rule
All current and future KB markdown files must follow highlight callout formatting for critical text:
1. > **NOTE:** for contextual reminders
2. > **IMPORTANT:** for mandatory requirements
3. > **WARNING:** for risks or escalation triggers

## Progress
- Total mapped items: 21
- Migrated: 21
- Planned: 0
- Not applicable (kept in code): 3

## Migrated Items
1. kb/modules/module-ci.md
2. kb/modules/module-dl.md
3. kb/modules/module-skip-collect.md
4. kb/modules/module-workforce.md
5. kb/modules/module-forms.md
6. kb/workflows/workflow-dl-status-flow.md
7. kb/workflows/workflow-field-checkin.md
8. kb/troubleshooting/troubleshoot-gps-location.md
9. kb/troubleshooting/troubleshoot-lark.md
10. kb/troubleshooting/troubleshoot-forms.md
11. kb/troubleshooting/troubleshoot-app-update.md
12. kb/faq/faq-banks.md
13. kb/faq/faq-tagging.md
14. kb/glossary/platform-overview.md
15. kb/workflows/dl-status-flow-reference.md
16. kb/troubleshooting/core-troubleshooting-reference.md
17. kb/glossary/banks-supported.md
18. kb/glossary/supported-file-formats.md
19. kb/policies/operational-hours.md
20. kb/modules/index.md
21. kb/workflows/index.md

## Policy Files Kept In Code
1. src/openci-kb.ts OPENCI_SYSTEM_PROMPT
2. src/openci-kb.ts OPENCI_ANONYMOUS_KB
3. src/openci-kb.ts OPENCI_AUTHENTICATED_KB

## Migration Quality Gate
A planned file cannot be marked as migrated unless highlight callout requirements are satisfied where critical guidance exists.

## Migration Completion
- All 21 items migrated on 2026-03-19
- All files enriched with full content from TypeScript sources
- All YAML frontmatter validated per MD_KB_SPEC.md
- Highlight callout requirements satisfied on all files
