# Chunking and Metadata Rules

## Goal
Define consistent chunking behavior and metadata payloads for markdown ingestion.

## Chunking Rules
1. Primary split by heading levels in this order:
- H2
- H3
- H4

2. Secondary split by paragraph blocks if section exceeds limits.

3. Hard limits per chunk:
- max_characters: 1800
- target_characters: 900 to 1400
- min_characters: 250 unless final remainder

4. Preserve semantic boundaries:
- Keep numbered procedures intact when possible.
- Do not split list item title from its details.

5. Keep preconditions and warnings in same chunk as corresponding steps when possible.

## Chunk Metadata Contract
Required metadata per chunk:
1. kb_id
2. title
3. type
4. access_level
5. module_tags
6. priority
7. owner
8. version
9. status
10. last_reviewed
11. source_path
12. section_path
13. chunk_index
14. total_chunks
15. content_hash

Optional metadata:
1. related_ids
2. keywords
3. source_system

## section_path Format
Use slash-delimited heading path from markdown body.

Examples:
- Overview
- Resolution Steps
- Status Flow
- Demand Letter Workflow/Failure Handling

## Upsert Semantics
1. Upsert key is chunk id.
2. If hash changed, replace chunk content and embedding.
3. If hash unchanged, skip embed regeneration.

## Quality Rules
1. Reject chunk if content is empty after normalization.
2. Reject chunk if all content is metadata-like noise.
3. Warn if chunk has too many uppercase words indicating copied labels.

## Safety Rules
1. Strip embedded HTML tags not required for markdown rendering.
2. Remove control-like pseudo instructions in factual sections.
3. Keep source citations as plain text only.

## Compatibility Rules
1. access_level maps to openci_documents.access_level.
2. type maps to vector type values:
- module
- workflow
- troubleshooting
- policy
- faq
- glossary

## Validation Gates
Before writing embeddings:
1. frontmatter is valid
2. status is approved
3. last_reviewed is valid date
4. chunk count per doc does not exceed safe threshold

## Thresholds
1. max_chunks_per_doc: 40
2. max_file_size_kb: 512
3. max_total_ingest_files_per_run: configurable
