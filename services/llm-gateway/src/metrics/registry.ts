type Labels = Record<string, string | number | boolean | undefined>;

type Counter = {
  help: string;
  values: Map<string, { labels: Labels; value: number }>;
};

type Histogram = {
  help: string;
  buckets: number[];
  values: Map<
    string,
    {
      labels: Labels;
      buckets: number[];
      sum: number;
      count: number;
    }
  >;
};

export type MetricsRegistry = {
  increment(name: string, help: string, labels?: Labels, value?: number): void;
  observe(name: string, help: string, buckets: number[], labels: Labels, value: number): void;
  render(): string;
};

function labelKey(labels: Labels = {}): string {
  return Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  return `{${entries
    .map(([key, value]) => `${key}="${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",")}}`;
}

function metricName(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9_:]/g, "_");
}

export function createMetricsRegistry(): MetricsRegistry {
  const counters = new Map<string, Counter>();
  const histograms = new Map<string, Histogram>();

  return {
    increment(name, help, labels = {}, value = 1) {
      const safeName = metricName(name);
      const counter = counters.get(safeName) ?? {
        help,
        values: new Map<string, { labels: Labels; value: number }>(),
      };
      const key = labelKey(labels);
      const current = counter.values.get(key) ?? { labels, value: 0 };
      current.value += value;
      counter.values.set(key, current);
      counters.set(safeName, counter);
    },

    observe(name, help, buckets, labels, value) {
      const safeName = metricName(name);
      const histogram = histograms.get(safeName) ?? {
        help,
        buckets: [...buckets].sort((left, right) => left - right),
        values: new Map(),
      };
      const key = labelKey(labels);
      const current =
        histogram.values.get(key) ??
        {
          labels,
          buckets: Array.from({ length: histogram.buckets.length }, () => 0),
          sum: 0,
          count: 0,
        };

      histogram.buckets.forEach((bucket, index) => {
        if (value <= bucket) current.buckets[index] += 1;
      });
      current.sum += value;
      current.count += 1;
      histogram.values.set(key, current);
      histograms.set(safeName, histogram);
    },

    render() {
      const lines: string[] = [];

      for (const [name, counter] of counters) {
        lines.push(`# HELP ${name} ${counter.help}`);
        lines.push(`# TYPE ${name} counter`);
        for (const { labels, value } of counter.values.values()) {
          lines.push(`${name}${formatLabels(labels)} ${value}`);
        }
      }

      for (const [name, histogram] of histograms) {
        lines.push(`# HELP ${name} ${histogram.help}`);
        lines.push(`# TYPE ${name} histogram`);
        for (const value of histogram.values.values()) {
          histogram.buckets.forEach((bucket, index) => {
            lines.push(
              `${name}_bucket${formatLabels({ ...value.labels, le: bucket })} ${value.buckets[index]}`,
            );
          });
          lines.push(`${name}_bucket${formatLabels({ ...value.labels, le: "+Inf" })} ${value.count}`);
          lines.push(`${name}_sum${formatLabels(value.labels)} ${value.sum}`);
          lines.push(`${name}_count${formatLabels(value.labels)} ${value.count}`);
        }
      }

      return `${lines.join("\n")}\n`;
    },
  };
}

export const httpDurationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
export const guardrailDurationBuckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
export const upstreamDurationBuckets = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

