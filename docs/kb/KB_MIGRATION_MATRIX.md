# TS to Markdown Migration Matrix

## Purpose
Map all current KB sources to target markdown files and track migration status.

## Status Legend
- migrated: target markdown exists
- planned: target markdown path defined, content pending migration
- not-applicable: remains in code by design

## Mandatory Highlight Compliance
All migrated and newly created KB markdown files must apply the highlight standard defined in [docs/kb/MD_KB_SPEC.md](docs/kb/MD_KB_SPEC.md):
1. Use NOTE, IMPORTANT, and WARNING callouts for high-impact lines.
2. Keep highlight usage limited and intentional.
3. Consider migration incomplete if required highlights are missing for critical instructions.

## A. Policy and Guardrails
| Source | Target | Status | Notes |
|---|---|---|---|
| src/openci-kb.ts OPENCI_SYSTEM_PROMPT | Keep in src/openci-kb.ts | not-applicable | Behavioral and safety guardrails remain code-first |
| src/openci-kb.ts OPENCI_ANONYMOUS_KB | Keep in src/openci-kb.ts | not-applicable | Access behavior and conversation flow policy |
| src/openci-kb.ts OPENCI_AUTHENTICATED_KB | Keep in src/openci-kb.ts | not-applicable | Authenticated conversation behavior |

## B. Factual KB in ai-service
| Source | Target Markdown | Status | Notes |
|---|---|---|---|
| src/ai-service.ts CORE_KB platform overview | kb/glossary/platform-overview.md | migrated | Full platform overview with modules, workflows, and hours |
| src/ai-service.ts CORE_KB module workflows | kb/workflows/dl-status-flow-reference.md | migrated | Complete DL workflow reference with admin actions |
| src/ai-service.ts CORE_KB troubleshooting snippets | kb/troubleshooting/core-troubleshooting-reference.md | migrated | Consolidated quick-reference with escalation paths |

## C. Vector Seed Documents
| ID | Source Line | Type | Target Markdown | Status |
|---|---|---|---|---|
| module-ci | src/openci-documents.ts#L14 | module | kb/modules/module-ci.md | migrated |
| module-dl | src/openci-documents.ts#L34 | module | kb/modules/module-dl.md | migrated |
| module-skip-collect | src/openci-documents.ts#L57 | module | kb/modules/module-skip-collect.md | migrated |
| module-workforce | src/openci-documents.ts#L82 | module | kb/modules/module-workforce.md | migrated |
| module-forms | src/openci-documents.ts#L108 | module | kb/modules/module-forms.md | migrated |
| troubleshoot-lark | src/openci-documents.ts#L136 | troubleshooting | kb/troubleshooting/troubleshoot-lark.md | migrated |
| troubleshoot-gps | src/openci-documents.ts#L166 | troubleshooting | kb/troubleshooting/troubleshoot-gps-location.md | migrated |
| troubleshoot-app-update | src/openci-documents.ts#L201 | troubleshooting | kb/troubleshooting/troubleshoot-app-update.md | migrated |
| troubleshoot-forms | src/openci-documents.ts#L241 | troubleshooting | kb/troubleshooting/troubleshoot-forms.md | migrated |
| procedure-dl-generation | src/openci-documents.ts#L292 | workflow | kb/workflows/workflow-dl-status-flow.md | migrated |
| procedure-field-checkin | src/openci-documents.ts#L351 | workflow | kb/workflows/workflow-field-checkin.md | migrated |
| faq-banks | src/openci-documents.ts#L411 | faq | kb/faq/faq-banks.md | migrated |
| faq-tagging | src/openci-documents.ts#L430 | faq | kb/faq/faq-tagging.md | migrated |

## D. Structured Lookup Object
| Source | Target Markdown | Status | Notes |
|---|---|---|---|
| src/openci-kb.ts OPENCI_KNOWLEDGE_BASE.modules | kb/modules/index.md | migrated | Module directory index |
| src/openci-kb.ts OPENCI_KNOWLEDGE_BASE.banks | kb/glossary/banks-supported.md | migrated | Complete bank list reference |
| src/openci-kb.ts OPENCI_KNOWLEDGE_BASE.workflows | kb/workflows/index.md | migrated | Workflow directory index |
| src/openci-kb.ts OPENCI_KNOWLEDGE_BASE.supportedFormats | kb/glossary/supported-file-formats.md | migrated | File format reference |
| src/openci-kb.ts OPENCI_KNOWLEDGE_BASE.operationalHours | kb/policies/operational-hours.md | migrated | Operational policy reference |

## Completion Criteria
1. All sources are inventoried and mapped. ✅
2. Every current KB entry has a target markdown path. ✅
3. Policy-vs-factual split is explicitly defined. ✅
4. Highlight callout standard is applied to all migrated KB files with critical instructions. ✅

Status: complete.
Migration completed: 2026-03-19.
