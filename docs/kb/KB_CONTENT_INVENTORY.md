# KB Content Inventory

## Purpose
This inventory lists all current factual knowledge sources and entries that must migrate to markdown.

## Current Factual KB Sources
1. [src/openci-documents.ts](src/openci-documents.ts#L9)
- Vector seed documents used for semantic retrieval.

2. [src/ai-service.ts](src/ai-service.ts#L61)
- CORE_KB factual block mixed with runtime logic.

3. [src/openci-kb.ts](src/openci-kb.ts#L194)
- OPENCI_KNOWLEDGE_BASE structured object used by demo lookup and quick references.

## Current Policy/Behavior Sources (Remain in Code)
1. [src/openci-kb.ts](src/openci-kb.ts#L7)
- OPENCI_SYSTEM_PROMPT and guardrails.

2. [src/openci-kb.ts](src/openci-kb.ts#L236)
- OPENCI_ANONYMOUS_KB behavioral policy layer.

3. [src/openci-kb.ts](src/openci-kb.ts#L297)
- OPENCI_AUTHENTICATED_KB behavioral policy layer.

## Extracted Document IDs From Vector Seed
Source: [src/openci-documents.ts](src/openci-documents.ts#L14)

Modules:
1. module-ci
2. module-dl
3. module-skip-collect
4. module-workforce
5. module-forms

Troubleshooting:
1. troubleshoot-lark
2. troubleshoot-gps
3. troubleshoot-app-update
4. troubleshoot-forms

Procedures or Workflows:
1. procedure-dl-generation
2. procedure-field-checkin

FAQ:
1. faq-banks
2. faq-tagging

Total extracted documents: 13

## Inventory Notes
1. There is overlapping factual content between CORE_KB and vector seed docs.
2. There is overlap between OPENCI_KNOWLEDGE_BASE lists and vector seed docs.
3. Consolidation in markdown should de-duplicate factual statements while preserving policy guardrails in code.

## Outcome
This inventory is complete and ready for migration mapping.
