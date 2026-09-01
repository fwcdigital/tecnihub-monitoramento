export interface LoginRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class LoginRateLimiter {
  private attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  check(key: string): LoginRateLimitResult {
    const currentTime = this.now();
    const recentAttempts = (this.attempts.get(key) || []).filter(
      (timestamp) => currentTime - timestamp < this.windowMs
    );
    this.attempts.set(key, recentAttempts);

    if (recentAttempts.length < this.maxAttempts) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const retryAfterMs = this.windowMs - (currentTime - recentAttempts[0]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  recordFailure(key: string): void {
    const currentTime = this.now();
    const recentAttempts = (this.attempts.get(key) || []).filter(
      (timestamp) => currentTime - timestamp < this.windowMs
    );
    recentAttempts.push(currentTime);
    this.attempts.set(key, recentAttempts);
  }

  consume(key: string): LoginRateLimitResult {
    const result = this.check(key);
    if (result.allowed) this.recordFailure(key);
    return result;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
