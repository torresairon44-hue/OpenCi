# Monitoring and Incident Plan

## Purpose
Define operational monitoring and incident response during markdown KB rollout.

## Key Metrics
Security:
1. access_leakage_count
2. injection_probe_failures
3. unauthorized_chunk_exposure

Quality:
1. critical_intent_pass_rate
2. retrieval_relevance_score
3. contradiction_rate

Performance:
1. retrieval_latency_p50
2. retrieval_latency_p95
3. ingestion_elapsed_ms
4. startup_reindex_duration

Reliability:
1. ingestion_failure_count
2. retrieval_error_rate
3. fallback_activation_count

## Alert Thresholds
1. Any access leakage event: immediate critical alert.
2. Retrieval error rate above threshold for sustained window: high alert.
3. p95 latency above SLO for sustained window: high alert.

## Incident Severity
1. Sev-1
- Security leakage
- Policy bypass

2. Sev-2
- Broad retrieval failure
- Severe latency regression

3. Sev-3
- Non-critical ingestion warnings

## Response Workflow
1. Detect and triage.
2. Contain via feature flag adjustment.
3. Communicate status updates.
4. Recover service behavior.
5. Conduct post-incident review.

## Required Logs and Artifacts
1. Ingestion run summaries
2. Per-file validation failures
3. Retrieval query traces with redaction
4. Feature flag change history
5. Incident timeline notes

## Post-Incident Review
1. Root cause summary
2. Impact and duration
3. Corrective and preventive actions
4. Re-entry criteria for resumed rollout
