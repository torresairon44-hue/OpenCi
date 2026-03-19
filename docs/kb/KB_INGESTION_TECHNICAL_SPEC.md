# Markdown Ingestion Technical Specification

## Objective
Define an implementation-ready ingestion architecture that converts markdown knowledge files into vector-searchable documents while preserving access controls.

## Architecture Overview
1. Discovery
- Scan kb directory recursively.
- Include only .md files with valid frontmatter.

2. Validation
- Parse YAML frontmatter.
- Enforce required fields from the markdown schema.
- Reject files with invalid type, access_level, or status.

3. Normalization
- Normalize line endings.
- Strip unsupported markdown artifacts.
- Convert headings and bullet sections into structured blocks.

4. Chunking
- Split content into semantic chunks by heading first.
- Apply token and character thresholds.
- Carry metadata to every chunk.

5. Persistence
- Upsert chunks into openci_documents through vector store add path.
- Use deterministic IDs per chunk.

6. Index Refresh
- Mark old versions stale if source version changed.
- Keep active version pointer by id and version.

## Runtime Integration Points
1. Vector write path
- [src/vector-store.ts](src/vector-store.ts#L133)

2. Search retrieval path
- [src/ai-service.ts](src/ai-service.ts#L271)

3. Startup initialization hook
- [src/init-utils.ts](src/init-utils.ts#L51)
- [src/index.ts](src/index.ts#L257)

## Proposed Components
1. src/kb-ingest/types.ts
- TypeScript interfaces for frontmatter, chunk, ingestion result.

2. src/kb-ingest/parser.ts
- File discovery and markdown parsing.

3. src/kb-ingest/validator.ts
- Schema and policy validation.

4. src/kb-ingest/chunker.ts
- Heading-aware chunking and overflow split.

5. src/kb-ingest/upsert.ts
- Transform chunks into VectorDocument writes.

6. src/kb-ingest/reporter.ts
- Summaries, warnings, and metrics.

7. src/kb-ingest/index.ts
- Orchestrator entrypoint.

## Deterministic ID Strategy
Chunk id format:
- kb-{doc_id}-v{version}-c{chunk_index}

Examples:
- kb-module-dl-v1.2.0-c01
- kb-troubleshoot-lark-v1.0.3-c02

## Access Control Strategy
1. access_level in markdown frontmatter must map directly to stored document access_level.
2. Retrieval filtering by access_level remains enforced in chat retrieval path.
3. Public chunks never include authenticated-only operational content.

## Incremental Reindex Strategy
1. Hash file content and frontmatter.
2. Skip unchanged files.
3. Reindex only changed files.
4. Keep reindex manifest file for audit.

## Failure Policy
1. Hard fail on schema violations.
2. Soft warn on non-critical style issues.
3. Continue processing remaining files after per-file failure.
4. Emit exit code non-zero when hard failures exist.

## Observability
Track metrics:
1. files_scanned
2. files_valid
3. files_invalid
4. chunks_created
5. chunks_upserted
6. chunks_failed
7. elapsed_ms

## Security Controls
1. Reject html script tags in markdown body.
2. Reject prompt-control tokens in factual sections if policy forbids them.
3. Enforce max file size and max chunk count per file.
4. Sanitize all text before prompt assembly.

## Acceptance Criteria
1. Ingestion processes all approved markdown files.
2. Every chunk is queryable with correct metadata.
3. Access-level filtering works for anonymous and authenticated paths.
4. Reindex run is repeatable and deterministic.

## Out of Scope
1. UI-based markdown editor.
2. Live end-user uploads of markdown.
3. Production deployment steps.
