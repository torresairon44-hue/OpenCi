# Validation and Error Contract

## Purpose
Standardize validation outcomes and error reporting for markdown ingestion runs.

## Validation Stages
1. File discovery validation
2. Frontmatter schema validation
3. Access and status policy validation
4. Chunking validation
5. Upsert and embedding write validation

## Error Severity Levels
1. error
- Blocks ingestion for the affected file.

2. warning
- Ingestion may continue but requires review.

3. info
- Non-blocking diagnostics.

## Error Codes
Schema:
- KB_SCHEMA_MISSING_FIELD
- KB_SCHEMA_INVALID_TYPE
- KB_SCHEMA_INVALID_ACCESS_LEVEL
- KB_SCHEMA_INVALID_STATUS
- KB_SCHEMA_INVALID_DATE

Policy:
- KB_POLICY_NOT_APPROVED
- KB_POLICY_FORBIDDEN_CONTENT
- KB_POLICY_ACCESS_MISMATCH

Chunking:
- KB_CHUNK_EMPTY
- KB_CHUNK_TOO_MANY
- KB_CHUNK_TOO_LARGE

Persistence:
- KB_UPSERT_FAILED
- KB_EMBEDDING_FAILED

## Per-File Result Shape
```json
{
  "sourcePath": "kb/modules/module-dl.md",
  "kbId": "module-dl",
  "status": "failed",
  "errors": [
    {
      "code": "KB_SCHEMA_INVALID_DATE",
      "severity": "error",
      "message": "last_reviewed must use YYYY-MM-DD",
      "field": "last_reviewed"
    }
  ],
  "warnings": [],
  "chunksCreated": 0,
  "chunksUpserted": 0,
  "elapsedMs": 12
}
```

## Run Summary Shape
```json
{
  "startedAt": "2026-03-18T10:00:00.000Z",
  "endedAt": "2026-03-18T10:00:03.500Z",
  "filesScanned": 18,
  "filesPassed": 16,
  "filesFailed": 2,
  "chunksCreated": 64,
  "chunksUpserted": 64,
  "chunksFailed": 0,
  "hasErrors": true
}
```

## Exit Behavior
1. Exit code 0
- No error severity findings.

2. Exit code 1
- One or more error severity findings.

## Reporting Output
1. Console summary for quick diagnostics.
2. JSON artifact in docs/kb/reports or configurable path.
3. Optional markdown report for human review.

## Minimum Review Gates
1. No schema errors.
2. No policy errors.
3. Warnings triaged and accepted.
4. Access-level checks passed.

## Security Checks
1. Reject scripts and active content.
2. Reject unauthorized access_level combinations.
3. Reject files exceeding configured size and chunk limits.

## Operator Guidance
1. Fix schema errors first.
2. Fix policy/access errors next.
3. Re-run ingestion and compare run summaries.
4. Promote only when all critical gates pass.
