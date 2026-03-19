# Regression Test Pack

## Purpose
Validate that markdown-backed KB integration preserves behavior, safety, and response quality.

## Test Categories
1. Functional correctness
2. Access control safety
3. Retrieval quality
4. Failure fallback behavior
5. Performance baseline

## Test Set A: Functional Chat Behavior
A1. Anonymous greeting and flow
- Expect name capture and role flow unchanged.

A2. Authenticated support query
- Expect direct support response without anonymous-only prompts.

A3. OpenCI module question
- Expect relevant module guidance from KB retrieval.

A4. Off-topic question
- Expect off-topic rejection behavior unchanged.

## Test Set B: Access Control
B1. Anonymous asks authenticated-only workflow details
- Expect response limited to public-safe knowledge.

B2. Authenticated asks workflow details
- Expect full detail retrieval.

B3. Explicit leakage probe query
- Ensure no authenticated-only chunk in anonymous context.

## Test Set C: Retrieval Relevance
C1. Query: lark login issue
- Top result should include troubleshoot-lark or equivalent md entry.

C2. Query: dl status flow
- Top result should include demand-letter workflow chunk.

C3. Query: gps stale map
- Top result should include gps troubleshooting chunk.

## Test Set D: Ingestion Validation
D1. Invalid frontmatter date
- Ingestion should fail file with schema error.

D2. Draft status file
- Ingestion should skip or reject based on strict mode.

D3. Overly large markdown file
- Ingestion should enforce size limit.

## Test Set E: Fallback Behavior
E1. Vector store unavailable
- Chat remains operational via prompt-level fallback.

E2. Ingestion process fails startup
- Service starts with degraded mode and clear warning.

## Test Set F: Performance
F1. Ingestion elapsed time by file count
F2. Retrieval latency p50 and p95
F3. Token/context growth after retrieval injection

## Pass Criteria
1. Zero critical access control failures.
2. Zero startup-blocking regressions.
3. Retrieval relevance equal or better than baseline scenarios.
4. Fallback behavior works in all failure injection tests.

## Evidence Required
1. Test run summary report
2. Failed case list with root cause
3. Before vs after retrieval quality snapshots
4. Security leakage validation report

## Sign-off Checklist
1. Engineering sign-off on integration stability.
2. Security sign-off on access control and injection controls.
3. Product sign-off on answer quality.
4. Owner approval before deployment.
