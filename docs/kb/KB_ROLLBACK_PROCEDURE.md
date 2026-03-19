# Rollback Procedure

## Purpose
Provide a deterministic rollback process for markdown-backed KB rollout.

## Rollback Triggers
1. Access control leakage.
2. Prompt-policy bypass behavior.
3. Sustained retrieval errors.
4. Severe latency regression.
5. Data integrity mismatch in indexed chunks.

## Immediate Actions
1. Disable KB_MD_RETRIEVAL_ENABLED flag.
2. Keep service in stable fallback mode.
3. Notify incident channel and stakeholders.

## Data Rollback Actions
1. Revert active ingestion manifest to previous known-good version.
2. Mark current rollout batch as invalid.
3. Restore prior index snapshot if available.

## Verification Steps
1. Confirm anonymous route cannot access authenticated-only chunks.
2. Confirm baseline response behavior restored.
3. Confirm error rates and latency return to prior baseline.

## Post-Rollback Steps
1. Collect incident timeline.
2. Document root cause and corrective action.
3. Re-run security and quality gates before any retry.

## Rollback Exit Criteria
1. System stable at baseline behavior.
2. Critical incident status resolved.
3. Stakeholders informed of closure.
