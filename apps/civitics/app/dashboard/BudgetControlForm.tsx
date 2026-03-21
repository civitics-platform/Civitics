"use client";

/**
 * BudgetControlForm — inline admin form for adjusting cost gate thresholds.
 *
 * Saves values to pipeline_state key 'cost_config_overrides' via
 * /api/admin/budget-config. Changes take effect on the next pipeline run.
 *
 * Admin-only — rendered only when isAdmin is true (server-checked).
 */

import { useState } from "react";

interface BudgetField {
  key:         string;
  label:       string;
  defaultVal:  string;
  placeholder: string;
  prefix:      string;
  suffix:      string;
}

const FIELDS: BudgetField[] = [
  { key: "monthly_hard_limit_usd",          label: "Monthly limit",     defaultVal: "3.50",  placeholder: "3.50", prefix: "$", suffix: "" },
  { key: "auto_approve_under_usd",          label: "Auto-approve under", defaultVal: "0.05",  placeholder: "0.05", prefix: "$", suffix: "" },
  { key: "autonomous.max_auto_approve_usd", label: "Autonomous max",    defaultVal: "0.10",  placeholder: "0.10", prefix: "$", suffix: "" },
  { key: "monthly_warning_pct",             label: "Alert at",          defaultVal: "75",    placeholder: "75",   prefix: "",  suffix: "%" },
];

export function BudgetControlForm() {
  const [values, setValues]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState<string | null>(null);
  const [saved, setSaved]     = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const save = async (field: BudgetField) => {
    const val = values[field.key] ?? field.defaultVal;
    const num = parseFloat(val);
    if (isNaN(num)) { setError(`Invalid value for ${field.label}`); return; }

    setSaving(field.key);
    setError(null);
    try {
      const res = await fetch("/api/admin/budget-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field.key]: num }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Save failed");
      }
      setSaved(field.key);
      setTimeout(() => setSaved(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-1.5">
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {FIELDS.map((field) => (
        <div key={field.key} className="flex items-center gap-2">
          <label className="text-[11px] text-gray-500 w-28 shrink-0">{field.label}:</label>
          <div className="flex items-center gap-1">
            {field.prefix && <span className="text-[11px] text-gray-400">{field.prefix}</span>}
            <input
              type="number"
              step="0.01"
              value={values[field.key] ?? field.defaultVal}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-700 focus:border-indigo-400 focus:outline-none"
            />
            {field.suffix && <span className="text-[11px] text-gray-400">{field.suffix}</span>}
          </div>
          <button
            onClick={() => save(field)}
            disabled={saving === field.key}
            className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving === field.key ? "…" : saved === field.key ? "✓" : "Save"}
          </button>
        </div>
      ))}
      <p className="text-[10px] text-gray-400 italic">
        Overrides take effect on next pipeline run. Resets to defaults on code deploy.
      </p>
    </div>
  );
}
