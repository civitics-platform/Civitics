export type VizMode = "force" | "treemap" | "chord" | "sunburst";

export interface VizRegistryEntry {
  id: VizMode;
  label: string;
  civicQuestion: string;
  description: string;
  status: "active" | "coming_soon";
  /** Icon: inline SVG path string */
  icon: string;
}

export const VIZ_REGISTRY: VizRegistryEntry[] = [
  {
    id: "force",
    label: "Force Graph",
    civicQuestion: "How are these entities connected?",
    description: "Organic force-directed layout reveals clusters and bridge nodes",
    status: "active",
    icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z",
  },
  {
    id: "treemap",
    label: "Treemap",
    civicQuestion: "Who receives the most donations?",
    description: "Officials sized by donations received, grouped by party",
    status: "active",
    icon: "M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z",
  },
  {
    id: "chord",
    label: "Chord Diagram",
    civicQuestion: "Which industries fund which political groups — and how much?",
    description: "Flows between donor industries and recipient party groups",
    status: "active",
    icon: "M12 2a10 10 0 100 20A10 10 0 0012 2zm0 2a8 8 0 110 16A8 8 0 0112 4z",
  },
  {
    id: "sunburst",
    label: "Sunburst",
    civicQuestion: "What is the full scope of this official's network?",
    description: "Concentric rings show votes, donors, and oversight connections",
    status: "active",
    icon: "M12 3v1m0 16v1M4.22 4.22l.707.707m12.02 12.02l.707.707M1 12h2m18 0h2M4.22 19.78l.707-.707m12.02-12.02l.707-.707",
  },
];

export const vizRegistry = new Map<VizMode, VizRegistryEntry>(
  VIZ_REGISTRY.map((v) => [v.id, v])
);
