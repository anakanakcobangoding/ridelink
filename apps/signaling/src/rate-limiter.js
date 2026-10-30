export class FixedWindowRateLimiter {
  constructor({ limits, now = Date.now, maxBuckets = 10_000 }) {
    this.limits = limits;
    this.now = now;
    this.maxBuckets = maxBuckets;
    this.buckets = new Map();
  }

  consume(scope, key) {
    const policy = this.limits[scope];
    if (!policy) return { allowed: true, retryAfterMs: 0 };

    const now = this.now();
    let bucketKey = `${scope}:${key}`;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket && this.buckets.size >= this.maxBuckets) {
      this.prune();
      if (this.buckets.size >= this.maxBuckets) {
        bucketKey = `${scope}:__overflow__`;
        bucket = this.buckets.get(bucketKey);
      }
    }
    if (!bucket || now >= bucket.startedAt + policy.windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;
    if (bucket.count <= policy.limit) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: Math.max(1, bucket.startedAt + policy.windowMs - now) };
  }

  prune() {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      const scope = key.slice(0, key.indexOf(":"));
      if (now >= bucket.startedAt + (this.limits[scope]?.windowMs ?? 0)) this.buckets.delete(key);
    }
  }
}
