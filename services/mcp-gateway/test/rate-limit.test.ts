import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createRateLimiter } from "../src/rate-limit/memory.js";
import type { RateLimitEntry, RateLimitStore } from "../src/rate-limit/types.js";
import type { AuthenticatedPrincipal } from "../src/types.js";

const principal = (sub: string): AuthenticatedPrincipal => ({
  sub,
  groups: [],
  claims: {},
});

describe("rate limiter", () => {
  it("limits calls per principal and tool key within a window", async () => {
    const limiter = createRateLimiter(loadConfig({ RATE_LIMIT_MAX: "2", RATE_LIMIT_WINDOW_MS: "1000" }), {
      now: () => 1_000,
    });

    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toEqual({
      allowed: true,
      remaining: 1,
      resetAt: 2_000,
    });
    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toEqual({
      allowed: true,
      remaining: 0,
      resetAt: 2_000,
    });
    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 2_000,
    });

    await expect(limiter.check(principal("user-2"), "example:echo")).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(limiter.check(principal("user-1"), "example:list")).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("starts a new bucket after the window expires", async () => {
    let currentTime = 1_000;
    const limiter = createRateLimiter(loadConfig({ RATE_LIMIT_MAX: "1", RATE_LIMIT_WINDOW_MS: "1000" }), {
      now: () => currentTime,
    });

    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toMatchObject({
      allowed: true,
      resetAt: 2_000,
    });
    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toMatchObject({
      allowed: false,
      resetAt: 2_000,
    });

    currentTime = 2_001;

    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toEqual({
      allowed: true,
      remaining: 0,
      resetAt: 3_001,
    });
  });

  it("can use an injected store implementation", async () => {
    const calls: Array<{ key: string; windowMs: number; now: number }> = [];
    const store: RateLimitStore = {
      async increment(key: string, windowMs: number, now: number): Promise<RateLimitEntry> {
        calls.push({ key, windowMs, now });
        return {
          count: calls.length,
          resetAt: now + windowMs,
        };
      },
    };
    const limiter = createRateLimiter(loadConfig({ RATE_LIMIT_MAX: "2", RATE_LIMIT_WINDOW_MS: "1000" }), {
      now: () => 5_000,
      store,
    });

    await expect(limiter.check(principal("user-1"), "example:echo")).resolves.toEqual({
      allowed: true,
      remaining: 1,
      resetAt: 6_000,
    });

    expect(calls).toEqual([
      {
        key: "user-1:example:echo",
        windowMs: 1_000,
        now: 5_000,
      },
    ]);
  });
});
