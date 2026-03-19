# KB Directory

This directory is the markdown source of truth for factual OpenCI knowledge.

## Subdirectories
- modules: module overview and capabilities
- workflows: procedural status and execution flows
- troubleshooting: symptoms, root causes, and fixes
- policies: operational rules and compliance instructions
- faq: concise question and answer entries
- glossary: terminology definitions

## Authoring Rules
1. Every file must include valid frontmatter fields from docs/kb/MD_KB_SPEC.md.
2. File name must match id plus .md.
3. Keep content concise, specific, and conflict-free.
4. Do not place secrets in markdown files.

## Highlighting Rules
Use standardized callout labels for high-impact information:

- > **NOTE:** contextual reminder
- > **IMPORTANT:** mandatory requirement
- > **WARNING:** risk or escalation condition

Guidelines:
1. Use highlights only for genuinely critical lines.
2. Prefer 1 to 3 highlights per section.
3. Keep regular text unhighlighted so callouts stand out.

## Approval Rule
Only files with status set to approved are eligible for production ingestion in future phases.
