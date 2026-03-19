# Quality Gate Framework

## Purpose
Define measurable quality standards for markdown-backed KB behavior.

## Gate Q1: Functional Equivalence
Checks:
1. Existing critical support intents still return expected guidance.
2. Anonymous and authenticated conversation flows remain correct.

Pass criteria:
1. 100 percent pass on critical baseline tests.

## Gate Q2: Retrieval Relevance
Checks:
1. Top results match expected domain for golden queries.
2. Retrieved chunks align with user intent and module context.

Pass criteria:
1. No critical query returns irrelevant domain chunk.
2. Relevance score trend is equal or better than baseline.

## Gate Q3: Consistency and Non-Contradiction
Checks:
1. Answers do not conflict across repeated runs.
2. No contradictory steps between prompt-level and retrieved KB.

Pass criteria:
1. Contradiction rate below agreed threshold.

## Gate Q4: Latency and Throughput
Checks:
1. Retrieval latency p50 and p95 remain within target.
2. Startup reindex duration remains within operational window.

Pass criteria:
1. Performance targets met in staging load test.

## Gate Q5: Content Governance Quality
Checks:
1. Approved status enforced for all production-eligible docs.
2. owner and last_reviewed fields present and valid.
3. Deprecated docs include replacement guidance.

Pass criteria:
1. Zero governance critical gaps.

## Gate Q6: Usability of KB Maintenance
Checks:
1. Content update process is reproducible by operations team.
2. New doc onboarding follows schema without engineering support.

Pass criteria:
1. At least one successful dry-run update by content owner.

## Quality KPIs
1. Critical intent pass rate
2. Retrieval precision for golden set
3. Response consistency score
4. Access violation count
5. Mean ingestion time per file

## Release Rule
1. All Q gates must pass or have accepted exceptions.
2. Exceptions require owner, expiration, and mitigation plan.

## Evidence Required
1. Golden test results
2. Relevance benchmark report
3. Latency benchmark report
4. Governance compliance snapshot
