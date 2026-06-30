import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { createMetricsRegistry } from "../src/metrics/registry.js";

describe("metrics registry", () => {
  it("renders counters and histograms in Prometheus text format", () => {
    const metrics = createMetricsRegistry();

    metrics.increment("test_counter_total", "A test counter", { status: 200 });
    metrics.observe("test_duration_seconds", "A test histogram", [0.1, 1], { route: "/mcp" }, 0.2);

    const rendered = metrics.render();

    expect(rendered).toContain("# TYPE test_counter_total counter");
    expect(rendered).toContain('test_counter_total{status="200"} 1');
    expect(rendered).toContain("# TYPE test_duration_seconds histogram");
    expect(rendered).toContain('test_duration_seconds_bucket{route="/mcp",le="1"} 1');
    expect(rendered).toContain('test_duration_seconds_count{route="/mcp"} 1');
  });
});

describe("server metrics endpoint", () => {
  it("exposes HTTP request metrics", async () => {
    const { app } = await buildServer();
    try {
      await app.inject({
        method: "GET",
        url: "/healthz",
      });

      const response = await app.inject({
        method: "GET",
        url: "/metrics",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.body).toContain("mcp_gateway_http_requests_total");
    } finally {
      await app.close();
    }
  });
});

