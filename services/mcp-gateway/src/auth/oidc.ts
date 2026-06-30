import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { AuthenticatedPrincipal } from "../types.js";

export type AuthService = {
  authenticate(request: FastifyRequest): Promise<AuthenticatedPrincipal>;
  challenge(): string;
};

function getBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}

function stringArrayClaim(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  return [];
}

export function createAuth(config: AppConfig): AuthService {
  const jwksUrl = config.oidcJwksUrl
    ? new URL(config.oidcJwksUrl)
    : new URL("/.well-known/jwks.json", config.oidcIssuer);
  const jwks = createRemoteJWKSet(jwksUrl);

  return {
    challenge() {
      return `Bearer realm="mcp-gateway", resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`;
    },
    async authenticate(request) {
      const token = getBearerToken(request);
      if (!token) {
        throw new Error("missing bearer token");
      }

      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.oidcIssuer,
        audience: config.oidcAudience,
      });

      if (payload.email_verified === false) {
        throw new Error("email is not verified");
      }

      const email = typeof payload.email === "string" ? payload.email : undefined;
      if (config.allowedEmailDomains.length > 0) {
        const domain = email?.split("@")[1]?.toLowerCase();
        if (!domain || !config.allowedEmailDomains.includes(domain)) {
          throw new Error("email domain is not allowed");
        }
      }

      const groups = stringArrayClaim(payload[config.groupsClaim]);
      if (
        config.allowedGroups.length > 0 &&
        !groups.some((group) => config.allowedGroups.includes(group))
      ) {
        throw new Error("group is not allowed");
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

