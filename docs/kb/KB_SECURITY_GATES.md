# Security Gate Framework

## Purpose
Define mandatory security checks that must pass before enabling markdown-backed retrieval in production.

## Gate S1: Access-Level Isolation
Checks:
1. Anonymous retrieval returns only public chunks.
2. Authenticated retrieval can access authenticated chunks.
3. No cross-leakage in mixed query scenarios.

Pass criteria:
1. Zero leakage findings in test pack B.

## Gate S2: Ingestion Input Safety
Checks:
1. Reject invalid frontmatter and unsupported types.
2. Reject active script-like content patterns.
3. Enforce max file size and max chunk limits.

Pass criteria:
1. All malicious test fixtures blocked.
2. No parser crashes on malformed markdown.

## Gate S3: Prompt Injection Resistance
Checks:
1. Strip control-like directives from factual chunks before prompt assembly.
2. Ensure policy prompt remains authoritative.
3. Validate retrieval text is treated as data, not policy override.

Pass criteria:
1. Injection probe suite has no policy bypass.

## Gate S4: Auditability and Traceability
Checks:
1. Every ingested chunk has source_path and content_hash.
2. Run summary and per-file results are saved.
3. Reindex manifest stores deterministic outcomes.

Pass criteria:
1. Full traceability for all chunks in sample run.

## Gate S5: Secrets and Sensitive Data Hygiene
Checks:
1. Block accidental credentials in markdown corpus.
2. Block personally sensitive data if outside approved policy.
3. Add secret-scan pre-ingestion step.

Pass criteria:
1. Zero critical secret exposure findings.

## Gate S6: Degraded Mode Safety
Checks:
1. If ingestion fails, startup remains stable in fallback mode.
2. If vector retrieval fails, chat still responds safely.
3. Failures are clearly logged without sensitive data in logs.

Pass criteria:
1. All fallback tests pass.

## Severity Model
1. Critical
- Access leakage
- Policy bypass
- Secret exposure

2. High
- Ingestion safety bypass
- Non-deterministic indexing

3. Medium
- Missing metadata fields
- Logging gaps

## Release Rule
1. Any critical failure blocks release.
2. Any high failure requires approved exception.
3. Medium failures require mitigation ticket and owner.

## Evidence Required
1. Security test report with case IDs.
2. Leakage report.
3. Injection probe report.
4. Secret scan report.
