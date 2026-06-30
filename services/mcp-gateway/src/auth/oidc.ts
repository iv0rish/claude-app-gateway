import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import type { AppConfig } from "../config.js";
import type { AuthenticatedPrincipal } from "../types.js";

export type AuthService = {
  authenticate(request: FastifyRequest): Promise<AuthenticatedPrincipal>;
  challenge(): string;
};

type AuthOptions = {
  jwks?: JWTVerifyGetKey;
};

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const bearerTokenPattern = /^[A-Za-z0-9._~+/-]+=*$/;

function getBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header) {
    throw new AuthError(401, "missing bearer token");
  }

  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    throw new AuthError(401, "invalid authorization header");
  }

  const token = parts[1];
  if (!token || !bearerTokenPattern.test(token)) {
    throw new AuthError(401, "invalid bearer token");
  }

  return token;
}

function stringArrayClaim(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  return [];
}

function quoteChallengeValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function bearerChallenge(params: Record<string, string>): string {
  return `Bearer ${Object.entries(params)
    .map(([key, value]) => `${key}=${quoteChallengeValue(value)}`)
    .join(", ")}`;
}

export function resolveJwksUrl(config: Pick<AppConfig, "oidcIssuer" | "oidcJwksUrl">): URL {
  return config.oidcJwksUrl
    ? new URL(config.oidcJwksUrl)
    : new URL("/.well-known/jwks.json", config.oidcIssuer);
}

export function createAuth(config: AppConfig, options: AuthOptions = {}): AuthService {
  const jwks = options.jwks ?? createRemoteJWKSet(resolveJwksUrl(config));
  const allowedEmailDomains = new Set(
    config.allowedEmailDomains.map((domain) => domain.toLowerCase()),
  );
  const allowedGroups = new Set(config.allowedGroups);

  return {
    challenge() {
      return bearerChallenge({
        realm: "mcp-gateway",
        resource_metadata: `${config.publicUrl}/.well-known/oauth-protected-resource`,
      });
    },
    async authenticate(request) {
      const token = getBearerToken(request);

      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.oidcIssuer,
        audience: config.oidcAudience,
      }).catch(() => {
        throw new AuthError(401, "invalid bearer token");
      });

      if (payload.email_verified === false) {
        throw new AuthError(403, "email is not verified");
      }

      const email = typeof payload.email === "string" ? payload.email : undefined;
      if (allowedEmailDomains.size > 0) {
        const domain = email?.split("@")[1]?.toLowerCase();
        if (!domain || !allowedEmailDomains.has(domain)) {
          throw new AuthError(403, "email domain is not allowed");
        }
      }

      const groups = stringArrayClaim(payload[config.groupsClaim]);
      if (
        allowedGroups.size > 0 &&
        !groups.some((group) => allowedGroups.has(group))
      ) {
        throw new AuthError(403, "group is not allowed");
      }

      return {
        sub: payload.sub ?? "unknown",
        email,
        groups,
        claims: payload as Record<string, unknown>,
      };
    },
  };
}
