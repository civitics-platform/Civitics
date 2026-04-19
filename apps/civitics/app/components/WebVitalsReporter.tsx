"use client";

import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";
import { reportWebVital } from "../../src/lib/web-vitals";

export function WebVitalsReporter() {
  const pathname = usePathname();
  useReportWebVitals((metric) => {
    void reportWebVital(metric, pathname || "/");
  });
  return null;
}
