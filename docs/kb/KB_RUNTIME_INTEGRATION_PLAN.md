# Runtime Integration Plan

## Goal
Integrate markdown-backed knowledge into runtime retrieval without breaking current chat behavior.

## Current Runtime Touchpoints
1. Chat generation pipeline: [src/ai-service.ts](src/ai-service.ts#L261)
2. Vector retrieval call: [src/ai-service.ts](src/ai-service.ts#L271)
3. Vector initialization: [src/ai-service.ts](src/ai-service.ts#L613)
4. Startup initialization: [src/index.ts](src/index.ts#L257)

## Integration Strategy
1. Keep policy prompts in code.
2. Replace static sample-document bootstrap source with markdown ingestion source.
3. Preserve retrieval fallback when vector is unavailable.
4. Keep access-level filtering logic unchanged.

## Feature Flag Plan
Proposed flags:
1. KB_MD_INGEST_ENABLED
2. KB_MD_INGEST_STRICT_MODE
3. KB_MD_RETRIEVAL_ENABLED

Flag behavior:
1. If disabled, existing behavior remains.
2. If enabled for ingest only, data populates but retrieval path unchanged.
3. If retrieval enabled, semantic search reads md-derived vectors.

## Rollout Stages
1. Stage A: Ingestion dry run in development.
2. Stage B: Ingestion write in staging with retrieval disabled.
3. Stage C: Retrieval canary in staging.
4. Stage D: Production canary and progressive rollout.

## Runtime Changes Needed
1. Replace direct load of OPENCI_SAMPLE_DOCUMENTS seed with ingestion orchestrator.
2. Add manifest tracking for indexed markdown versions.
3. Add runtime health endpoint fields for md ingest status.

## Fallback and Safety
1. If ingestion fails, keep existing startup operational.
2. If retrieval fails, continue with prompt-only answer path.
3. Log failures with error code and source file context.

## Access Control Validation
1. Confirm public users only retrieve access_level public chunks.
2. Confirm authenticated users retrieve both public and authenticated.
3. Confirm no leakage in anonymous routes.

## Operational Runbook
Startup sequence target:
1. Validate markdown corpus.
2. Perform incremental reindex.
3. Publish ingestion summary.
4. Enable retrieval flag only after gate pass.

## Exit Criteria
1. Retrieval quality meets baseline or better.
2. No access leakage detected.
3. Latency within accepted target.
4. Rollback switch tested and documented.

## Out of Scope
1. Deployment execution.
2. Production flag enablement.
3. Live end-user markdown uploads.
