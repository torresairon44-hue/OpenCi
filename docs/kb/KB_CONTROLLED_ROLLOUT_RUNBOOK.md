# Controlled Rollout Runbook

## Purpose
Define step-by-step rollout controls for markdown-backed KB integration.

## Preconditions
1. Security gates passed.
2. Quality gates passed.
3. Release readiness checklist approved.
4. Explicit user permission granted before production deployment.

## Rollout Stages
1. Development verification
- Enable ingest flag only.
- Run full ingestion and validate reports.

2. Staging ingest
- Enable ingest in staging.
- Keep retrieval flag disabled initially.
- Validate indexed chunk counts and metadata.

3. Staging retrieval canary
- Enable retrieval flag for controlled test users.
- Run regression suite and access leakage probes.

4. Production canary
- Enable retrieval for a small percentage or limited user segment.
- Monitor security and quality KPIs continuously.

5. Progressive increase
- Increase rollout in controlled increments.
- Pause or rollback on threshold breach.

## Gate Checkpoints
At each stage verify:
1. No critical security findings.
2. No access leakage.
3. Latency within bounds.
4. Retrieval relevance acceptable.

## Change Window Guidance
1. Deploy during low traffic period.
2. Keep on-call responders available.
3. Maintain communication channel for incident escalation.

## Hold and Abort Conditions
1. Any critical security failure.
2. Any authenticated-only leakage to anonymous users.
3. Persistent retrieval failures above threshold.
4. Latency degradation beyond defined SLO.

## Communication Plan
1. Pre-change notification.
2. Live status updates at each rollout stage.
3. Post-change summary with metrics.

## Completion Criteria
1. Full rollout completed without critical incidents.
2. KPIs stable for observation window.
3. Runbook execution log archived.
