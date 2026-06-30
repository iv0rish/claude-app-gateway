import type { AppConfig } from "../config.js";
import type { McpUpstream } from "../types.js";

export type UpstreamRegistry = {
  list(): McpUpstream[];
  first(): McpUpstream;
  get(name: string): McpUpstream | undefined;
};

export function createUpstreamRegistry(config: AppConfig): UpstreamRegistry {
  return {
    list() {
      return config.upstreams;
    },
    first() {
      return config.upstreams[0];
    },
    get(name) {
      return config.upstreams.find((upstream) => upstream.name === name);
    },
  };
}

