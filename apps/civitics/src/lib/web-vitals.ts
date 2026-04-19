// Client helper for reporting Core Web Vitals samples to our backend.
// Thresholds from web.dev (good/needs-improvement/poor boundaries).

export const VITALS_THRESHOLDS: Record<string, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

type VitalsMetric = {
  name: string;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  id: string;
};

export async function reportWebVital(metric: VitalsMetric, path: string) {
  const threshold = VITALS_THRESHOLDS[metric.name];
  const exceeded = threshold ? metric.value > threshold.poor : false;

  try {
    const body = JSON.stringify({
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      path,
      exceeded,
    });

    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(
        "/api/platform/web-vitals",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }

    await fetch("/api/platform/web-vitals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // Silent: telemetry failures must never break the page.
  }
}
