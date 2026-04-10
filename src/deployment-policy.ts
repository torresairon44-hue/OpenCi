export interface AIRoutingMetricsLike {
  requests: number;
  fallbackUsed: number;
  groqCalls: number;
  groqFailures: number;
  googleCalls: number;
  googleFailures: number;
  safetyRejections: number;
}

export interface CanaryPolicyStatus {
  sampleSize: number;
  providerFailureRate: number;
  fallbackRate: number;
  safetyRejectionRate: number;
  status: 'green' | 'yellow' | 'red';
  rollbackRecommended: boolean;
  reasons: string[];
  thresholds: {
    minSampleSize: number;
    maxProviderFailureRate: number;
    maxFallbackRate: number;
  };
}

function readNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function evaluateCanaryPolicy(metrics: AIRoutingMetricsLike): CanaryPolicyStatus {
  const minSampleSize = readNumber('CANARY_MIN_SAMPLE_SIZE', 50);
  const maxProviderFailureRate = readNumber('CANARY_MAX_PROVIDER_FAILURE_RATE', 0.2);
  const maxFallbackRate = readNumber('CANARY_MAX_FALLBACK_RATE', 0.15);

  const totalProviderCalls = Number(metrics.groqCalls || 0) + Number(metrics.googleCalls || 0);
  const totalProviderFailures = Number(metrics.groqFailures || 0) + Number(metrics.googleFailures || 0);
  const sampleSize = Number(metrics.requests || 0);

  const providerFailureRate = totalProviderCalls > 0 ? totalProviderFailures / totalProviderCalls : 0;
  const fallbackRate = sampleSize > 0 ? Number(metrics.fallbackUsed || 0) / sampleSize : 0;
  const safetyRejectionRate = sampleSize > 0 ? Number(metrics.safetyRejections || 0) / sampleSize : 0;

  const reasons: string[] = [];
  let status: 'green' | 'yellow' | 'red' = 'green';
  let rollbackRecommended = false;

  if (sampleSize < minSampleSize) {
    status = 'yellow';
    reasons.push(`Insufficient canary sample size (${sampleSize}/${minSampleSize}).`);
  }

  if (providerFailureRate > maxProviderFailureRate) {
    status = 'red';
    rollbackRecommended = true;
    reasons.push(`Provider failure rate ${providerFailureRate.toFixed(3)} exceeds ${maxProviderFailureRate.toFixed(3)}.`);
  }

  if (fallbackRate > maxFallbackRate) {
    status = 'red';
    rollbackRecommended = true;
    reasons.push(`Fallback rate ${fallbackRate.toFixed(3)} exceeds ${maxFallbackRate.toFixed(3)}.`);
  }

  if (reasons.length === 0) {
    reasons.push('Canary metrics within configured thresholds.');
  }

  return {
    sampleSize,
    providerFailureRate,
    fallbackRate,
    safetyRejectionRate,
    status,
    rollbackRecommended,
    reasons,
    thresholds: {
      minSampleSize,
      maxProviderFailureRate,
      maxFallbackRate,
    },
  };
}
