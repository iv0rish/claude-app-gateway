import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { GatewayApiKey } from "../config.js";
import type { AuthenticatedGateway } from "../types.js";

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export type AuthService = {
  authenticate(request: FastifyRequest): AuthenticatedGateway;
};

function extractKey(request: FastifyRequest): string | undefined {
  const xApiKey = request.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.length > 0) return xApiKey;

  const authorization = request.headers.authorization;
  if (!authorization) return undefined;
  const [scheme, token] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAuth(apiKeys: GatewayApiKey[]): AuthService {
  return {
    authenticate(request) {
      const key = extractKey(request);
      if (!key) {
        throw new AuthError(401, "missing gateway api key");
      }

      const match = apiKeys.find((candidate) => safeEqual(candidate.key, key));
      if (!match) {
        throw new AuthError(403, "invalid gateway api key");
      }

      return {
        tier: match.tier,
      };
    },
  };
}

