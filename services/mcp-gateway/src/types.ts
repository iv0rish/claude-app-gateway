import type { FastifyRequest } from "fastify";
import type { UpstreamConfig } from "./config.js";

export type AuthenticatedPrincipal = {
  sub: string;
  email?: string;
  groups: string[];
  claims: Record<string, unknown>;
};

export type RequestContext = {
  request: FastifyRequest;
  principal: AuthenticatedPrincipal;
};

export type ToolDecision = {
  allowed: boolean;
  reason: string;
};

export type McpUpstream = UpstreamConfig;

