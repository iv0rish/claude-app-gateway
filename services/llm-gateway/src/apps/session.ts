import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { AuthenticatedGateway } from "../types.js";

type DeviceGrant = {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  intervalSeconds: number;
  status: "pending" | "approved" | "denied";
  principal?: Principal;
};

type RefreshSession = {
  refreshToken: string;
  expiresAt: number;
  principal: Principal;
};

export type Principal = Required<Pick<AuthenticatedGateway, "subject" | "email" | "groups">> & {
  tier: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function userCode(): string {
  return randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-");
}

function json(input: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as Record<string, unknown>;
}

export class AppsSessionService {
  private readonly deviceGrants = new Map<string, DeviceGrant>();
  private readonly grantsByUserCode = new Map<string, string>();
  private readonly refreshSessions = new Map<string, RefreshSession>();
  private readonly secret: string;

  constructor(private readonly config: AppConfig) {
    this.secret =
      config.apps.session.jwtSecret ??
      (config.nodeEnv === "production" ? "" : "dev-only-llm-gateway-session-secret");

    if (config.apps.enabled && this.secret.length === 0) {
      throw new Error("apps.session.jwtSecret is required when Apps-compatible mode is enabled");
    }
  }

  enabled(): boolean {
    return this.config.apps.enabled;
  }

  metadata() {
    const issuer = this.issuer();
    return {
      issuer,
      device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
      token_endpoint: `${issuer}/oauth/token`,
      verification_uri: `${issuer}/device`,
      grant_types_supported: [
        "urn:ietf:params:oauth:grant-type:device_code",
        "refresh_token",
      ],
      scopes_supported: this.config.apps.oidc.scopes,
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  protocol() {
    return {
      gateway: "llm-gateway",
      protocol_version: "2026-07-01",
      endpoints: {
        device_authorization: "/oauth/device_authorization",
        token: "/oauth/token",
        managed_settings: "/managed/settings",
        models: "/v1/models",
        messages: "/v1/messages",
        count_tokens: "/v1/messages/count_tokens",
      },
      auth: {
        type: "oauth_device_code",
        issuer: this.issuer(),
      },
      capabilities: {
        managed_settings: true,
        model_policy: true,
        spend_limits: true,
        prompt_logging: this.config.promptLoggingEnabled,
        bedrock_guardrails:
          this.config.guardrailInputEnabled || this.config.guardrailOutputEnabled,
      },
    };
  }

  createDeviceGrant() {
    const expiresIn = 600;
    const grant: DeviceGrant = {
      deviceCode: randomToken(),
      userCode: userCode(),
      expiresAt: Date.now() + expiresIn * 1000,
      intervalSeconds: 5,
      status: "pending",
    };
    this.deviceGrants.set(grant.deviceCode, grant);
    this.grantsByUserCode.set(grant.userCode, grant.deviceCode);
    const verificationUri = `${this.issuer()}/device`;
    return {
      device_code: grant.deviceCode,
      user_code: grant.userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(grant.userCode)}`,
      expires_in: expiresIn,
      interval: grant.intervalSeconds,
    };
  }

  approveDeviceGrant(userCodeValue: string, principal: Partial<Principal>) {
    const deviceCode = this.grantsByUserCode.get(userCodeValue.toUpperCase());
    if (!deviceCode) return false;
    const grant = this.deviceGrants.get(deviceCode);
    if (!grant || grant.expiresAt <= Date.now()) return false;
    grant.status = "approved";
    grant.principal = {
      subject: principal.subject ?? principal.email ?? "unknown",
      email: principal.email ?? "unknown@example.com",
      groups: principal.groups ?? [],
      tier: principal.tier ?? "default",
    };
    return true;
  }

  exchangeDeviceCode(deviceCode: string): TokenResponse | { error: string } {
    const grant = this.deviceGrants.get(deviceCode);
    if (!grant || grant.expiresAt <= Date.now()) return { error: "expired_token" };
    if (grant.status === "pending") return { error: "authorization_pending" };
    if (grant.status === "denied" || !grant.principal) return { error: "access_denied" };
    this.deviceGrants.delete(deviceCode);
    this.grantsByUserCode.delete(grant.userCode);
    return this.issueTokens(grant.principal);
  }

  refresh(refreshToken: string): TokenResponse | { error: string } {
    const session = this.refreshSessions.get(refreshToken);
    if (!session || session.expiresAt <= Date.now()) return { error: "invalid_grant" };
    this.refreshSessions.delete(refreshToken);
    return this.issueTokens(session.principal);
  }

  authenticate(request: FastifyRequest): AuthenticatedGateway {
    const header = request.headers.authorization;
    if (!header) throw new Error("missing bearer token");
    const [scheme, token] = header.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== "bearer" || !token) throw new Error("invalid bearer token");
    return this.verifyAccessToken(token);
  }

  private issueTokens(principal: Principal): TokenResponse {
    const refreshToken = randomToken();
    this.refreshSessions.set(refreshToken, {
      refreshToken,
      principal,
      expiresAt: Date.now() + this.config.apps.session.refreshTokenTtlSeconds * 1000,
    });
    return {
      access_token: this.signAccessToken(principal),
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: this.config.apps.session.accessTokenTtlSeconds,
    };
  }

  private signAccessToken(principal: Principal): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.config.apps.session.issuer,
      aud: this.config.apps.session.audience,
      sub: principal.subject,
      email: principal.email,
      groups: principal.groups,
      tier: principal.tier,
      iat: now,
      exp: now + this.config.apps.session.accessTokenTtlSeconds,
    };
    const encoded = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
      JSON.stringify(payload),
    )}`;
    const signature = createHmac("sha256", this.secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  private verifyAccessToken(token: string): AuthenticatedGateway {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("invalid bearer token");
    const signed = `${parts[0]}.${parts[1]}`;
    const expected = createHmac("sha256", this.secret).update(signed).digest();
    const actual = Buffer.from(parts[2], "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("invalid bearer token");
    }
    const payload = json(parts[1]);
    if (payload.iss !== this.config.apps.session.issuer) throw new Error("invalid issuer");
    if (payload.aud !== this.config.apps.session.audience) throw new Error("invalid audience");
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("expired bearer token");
    }
    return {
      tier: typeof payload.tier === "string" ? payload.tier : "default",
      subject: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      groups: Array.isArray(payload.groups)
        ? payload.groups.filter((group): group is string => typeof group === "string")
        : [],
    };
  }

  private issuer(): string {
    return this.config.apps.externalUrl ?? `http://localhost:${this.config.port}`;
  }
}
