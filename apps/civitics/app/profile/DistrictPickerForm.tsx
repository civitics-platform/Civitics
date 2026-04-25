"use client";

import { useState, useEffect } from "react";

const US_STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

interface Rep {
  id: string;
  name: string;
  role: string;
  party?: string;
}

interface Props {
  initialState: string | null;
  initialDistrict: number | null;
}

export function DistrictPickerForm({ initialState, initialDistrict }: Props) {
  const [homeState, setHomeState] = useState(initialState ?? "");
  const [homeDistrict, setHomeDistrict] = useState<number | "">(initialDistrict ?? "");
  const [districts, setDistricts] = useState<number[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Fetch district list whenever state changes
  useEffect(() => {
    if (!homeState) { setDistricts([]); return; }
    fetch(`/api/profile/districts?state=${homeState}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setDistricts(d.districts ?? []))
      .catch(() => setDistricts([]));
    setHomeDistrict("");
  }, [homeState]);

  // Load representatives if we already have a configured district on mount
  useEffect(() => {
    if (!initialState) return;
    fetch("/api/graph/my-representatives", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d.configured) setReps(d.reps ?? []);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/profile/preferences", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          home_state: homeState || null,
          home_district: homeDistrict !== "" ? homeDistrict : null,
        }),
      });
      setSaved(true);
      // Refresh representatives preview
      const res = await fetch("/api/graph/my-representatives", { credentials: "include" });
      const d = await res.json();
      if (d.configured) setReps(d.reps ?? []);
    } catch {
      // fail silently — user can retry
    } finally {
      setSaving(false);
    }
  }

  const partyColor = (party?: string) => {
    if (party === "democrat") return "text-blue-600";
    if (party === "republican") return "text-red-600";
    return "text-purple-600";
  };

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">Your Congressional District</h3>
      <p className="mt-1 text-sm text-gray-500">
        Set your home district to see your representatives in the connection graph.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        {/* State picker */}
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">State</label>
          <select
            value={homeState}
            onChange={e => setHomeState(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Select state…</option>
            {US_STATES.map(([abbr, name]) => (
              <option key={abbr} value={abbr}>{name}</option>
            ))}
          </select>
        </div>

        {/* District picker */}
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">House District</label>
          <select
            value={homeDistrict}
            onChange={e => setHomeDistrict(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
            disabled={!homeState || districts.length === 0}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="">Select district…</option>
            {districts.map(d => (
              <option key={d} value={d}>CD-{d}</option>
            ))}
          </select>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!homeState || saving}
          className="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Representatives preview */}
      {reps.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-500 mb-2">Your federal representatives</p>
          <ul className="space-y-1.5">
            {reps.map(rep => (
              <li key={rep.id} className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${partyColor(rep.party)}`}>
                  {rep.name}
                </span>
                <span className="text-gray-400">&middot; {rep.role}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-400">
            Your alignment with these representatives will appear on the connection graph.
          </p>
        </div>
      )}
    </div>
  );
}
