import type { AuthenticatedPrincipal } from "../types.js";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  increment(key: string, windowMs: number, now: number): Promise<RateLimitEntry>;
};

export type RateLimiter = {
  check(principal: AuthenticatedPrincipal, toolKey: string): Promise<RateLimitResult>;
};
