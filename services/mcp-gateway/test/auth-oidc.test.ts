import type { FastifyRequest } from "fastify";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from "jose";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { AuthError, createAuth, resolveJwksUrl } from "../src/auth/oidc.js";

const issuer = "https://issuer.example.com/tenant";
const audience = "mcp-gateway";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 8080,
    publicUrl: "https://gateway.example.com",
    oidcIssuer: issuer,
    oidcAudience: audience,
    allowedEmailDomains: [],
    allowedGroups: [],
    groupsClaim: "groups",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
    upstreams: [{ name: "example", url: "http://127.0.0.1:9090/mcp", forwardHeaders: [] }],
    ...overrides,
  };
}

function request(authorization?: string): FastifyRequest {
  return {
    headers: authorization ? { authorization } : {},
  } as FastifyRequest;
}

async function localAuth(overrides: Partial<AppConfig> = {}) {
  const keyId = "test-key";
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = keyId;
  publicJwk.alg = "RS256";

  return {
    auth: createAuth(config(overrides), {
      jwks: createLocalJWKSet({ keys: [publicJwk] }),
    }),
    sign: (claims: Record<string, unknown> = {}) =>
      new SignJWT({
        email: "user@example.com",
        email_verified: true,
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: keyId })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("subject-1")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey as KeyLike),
  };
}

describe("OIDC auth", () => {
  it("builds the configured RFC-style bearer challenge", () => {
    const auth = createAuth(config({ oidcJwksUrl: "https://issuer.example.com/jwks" }));

    expect(auth.challenge()).toBe(
      'Bearer realm="mcp-gateway", resource_metadata="https://gateway.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it("resolves JWKS URL from explicit config before falling back to the existing issuer-relative path", () => {
    expect(
      resolveJwksUrl(config({ oidcJwksUrl: "https://keys.example.com/oauth/jwks" })).toString(),
    ).toBe("https://keys.example.com/oauth/jwks");

    expect(resolveJwksUrl(config()).toString()).toBe(
      "https://issuer.example.com/.well-known/jwks.json",
    );
  });

  it("rejects missing and malformed bearer headers with typed AuthError", async () => {
    const { auth } = await localAuth();

    await expect(auth.authenticate(request())).rejects.toMatchObject({
      name: "AuthError",
      status: 401,
      message: "missing bearer token",
    });
    await expect(auth.authenticate(request("Basic abc"))).rejects.toMatchObject({
      status: 401,
      message: "invalid authorization header",
    });
    await expect(auth.authenticate(request("Bearer abc def"))).rejects.toMatchObject({
      status: 401,
      message: "invalid authorization header",
    });
    await expect(auth.authenticate(request("Bearer bad,token"))).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("accepts case-insensitive bearer scheme and allowed email domains", async () => {
    const { auth, sign } = await localAuth({
      allowedEmailDomains: ["EXAMPLE.COM"],
      allowedGroups: ["admins"],
      groupsClaim: "roles",
    });
    const token = await sign({
      email: "USER@Example.Com",
      roles: ["admins", "operators"],
    });

    await expect(auth.authenticate(request(`bEaReR   ${token}`))).resolves.toMatchObject({
      sub: "subject-1",
      email: "USER@Example.Com",
      groups: ["admins", "operators"],
    });
  });

  it("extracts a string group claim as a single group", async () => {
    const { auth, sign } = await localAuth({
      allowedGroups: ["admins"],
      groupsClaim: "roles",
    });
    const token = await sign({ roles: "admins" });

    await expect(auth.authenticate(request(`Bearer ${token}`))).resolves.toMatchObject({
      groups: ["admins"],
    });
  });

  it("rejects verified tokens that fail email or group authorization with typed status", async () => {
    const emailAuth = await localAuth({ allowedEmailDomains: ["example.com"] });
    const wrongDomainToken = await emailAuth.sign({ email: "user@other.example" });

    await expect(emailAuth.auth.authenticate(request(`Bearer ${wrongDomainToken}`))).rejects.toMatchObject(
      {
        status: 403,
        message: "email domain is not allowed",
      },
    );

    const groupAuth = await localAuth({ allowedGroups: ["admins"] });
    const wrongGroupToken = await groupAuth.sign({ groups: ["operators"] });

    await expect(groupAuth.auth.authenticate(request(`Bearer ${wrongGroupToken}`))).rejects.toMatchObject(
      {
        status: 403,
        message: "group is not allowed",
      },
    );
  });
});
