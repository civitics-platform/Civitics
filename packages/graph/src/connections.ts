/**
 * packages/graph/src/connections.ts
 *
 * Single source of truth for all connection types in the platform.
 * Never hardcode connection type strings anywhere else in the codebase.
 * Always reference CONNECTION_TYPE_REGISTRY keys.
 */

import type { ConnectionTypeDefinition, GraphView } from './types'
import { isFocusGroup } from './types'

// ── Registry ───────────────────────────────────────────────────────────────────

export const CONNECTION_TYPE_REGISTRY: Record<string, ConnectionTypeDefinition> = {
  donation: {
    label: 'Donations',
    icon: '💰',
    color: '#f59e0b',
    description: 'PAC and individual donor contributions',
    hasAmount: true,
  },
  vote_yes: {
    label: 'Voted Yes',
    icon: '✓',
    color: '#22c55e',
    description: 'Affirmative votes on legislation',
    hasAmount: false,
  },
  vote_no: {
    label: 'Voted No',
    icon: '✗',
    color: '#ef4444',
    description: 'Negative votes on legislation',
    hasAmount: false,
  },
  vote_abstain: {
    label: 'Abstained',
    icon: '○',
    color: '#94a3b8',
    description: 'Present / not voting',
    hasAmount: false,
  },
  // NOTE: nomination_vote_yes/no are VALID and DISTINCT from vote_yes/vote_no.
  // They are derived from proposals with vote_category = 'nomination'.
  // Show in UI as "Nomination Votes" — never merge with "Legislation Votes".
  nomination_vote_yes: {
    label: 'Confirmed',
    icon: '⭐',
    color: '#8b5cf6',
    description: 'Voted to confirm nomination',
    hasAmount: false,
  },
  nomination_vote_no: {
    label: 'Rejected',
    icon: '✗',
    color: '#ec4899',
    description: 'Voted against confirmation',
    hasAmount: false,
  },
  oversight: {
    label: 'Oversight',
    icon: '👁',
    color: '#06b6d4',
    description: 'Committee oversight relationships',
    hasAmount: false,
  },
  co_sponsorship: {
    label: 'Co-Sponsored',
    icon: '🤝',
    color: '#84cc16',
    description: 'Bill co-sponsorship',
    hasAmount: false,
  },
  appointment: {
    label: 'Appointment',
    icon: '🪪',
    color: '#d97706',
    description: 'Cabinet- and agency-leadership appointments (official → agency)',
    hasAmount: false,
  },
  revolving_door: {
    label: 'Revolving Door',
    icon: '🔁',
    color: '#ec4899',
    description: 'Official ↔ corporation movement via career history',
    hasAmount: false,
  },
  alignment: {
    label: 'Alignment',
    icon: '≈',
    color: '#8b5cf6',
    description: 'Alignment between your civic positions and representative votes',
    hasAmount: false,
  },
}

// ── Default connection state for a new GraphView ───────────────────────────────
//
// These are the default enabled/opacity/thickness settings for each connection
// type when no preset is active. Note:
//   - vote_abstain and co_sponsorship are off by default (too noisy)
//   - All others are enabled by default
//   - Opacity and thickness are tuned for visual balance

export const DEFAULT_CONNECTION_STATE: GraphView['connections'] = {
  donation: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.donation!.color,
    opacity: 0.8,
    thickness: 0.7,
    minAmount: 0,
  },
  vote_yes: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.vote_yes!.color,
    opacity: 0.6,
    thickness: 0.4,
  },
  vote_no: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.vote_no!.color,
    opacity: 0.6,
    thickness: 0.4,
  },
  vote_abstain: {
    enabled: false,
    color: CONNECTION_TYPE_REGISTRY.vote_abstain!.color,
    opacity: 0.3,
    thickness: 0.2,
  },
  nomination_vote_yes: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.nomination_vote_yes!.color,
    opacity: 0.7,
    thickness: 0.5,
  },
  nomination_vote_no: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.nomination_vote_no!.color,
    opacity: 0.7,
    thickness: 0.5,
  },
  oversight: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.oversight!.color,
    opacity: 0.5,
    thickness: 0.3,
  },
  co_sponsorship: {
    enabled: false,
    color: CONNECTION_TYPE_REGISTRY.co_sponsorship!.color,
    opacity: 0.5,
    thickness: 0.3,
  },
  appointment: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.appointment!.color,
    opacity: 0.7,
    thickness: 0.4,
  },
  revolving_door: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.revolving_door!.color,
    opacity: 0.75,
    thickness: 0.5,
  },
  alignment: {
    enabled: true,
    color: CONNECTION_TYPE_REGISTRY.alignment!.color,
    opacity: 0.7,
    thickness: 0.5,
  },
}

// ── Focus-aware applicability (FIX-128) ────────────────────────────────────────
//
// Returns the set of connection types that *could* produce edges given the
// current focus. Types outside the set are still reachable (shown under a
// collapsed "Not applicable" sub-tree in ConnectionsTree) but the UI signals
// why toggling them won't render anything until the focus changes.
//
// Rules — see GRAPH_PLAN.md §3.1:
//   donation             — official OR pac/financial in focus
//   vote_* / nomination_ — official OR proposal in focus
//   co_sponsorship       — same as vote_*
//   oversight            — official OR agency in focus
//   alignment            — USER node visible
//
// Empty focus + no USER node → all types applicable (don't pre-disable a
// freshly-loaded panel before the user has done anything).

export function applicableConnectionTypes(
  focus: GraphView['focus'],
  userNodeVisible: boolean = false,
): Set<string> {
  const items = focus.entities;

  if (items.length === 0 && !userNodeVisible) {
    return new Set(Object.keys(CONNECTION_TYPE_REGISTRY));
  }

  let hasOfficial = false;
  let hasAgency = false;
  let hasFinancial = false;
  let hasProposal = false;

  for (const item of items) {
    if (isFocusGroup(item)) {
      const et = item.filter.entity_type;
      if (et === 'official') hasOfficial = true;
      else if (et === 'agency') hasAgency = true;
      else if (et === 'pac') hasFinancial = true;
      else if (et === 'proposal') hasProposal = true;
    } else {
      if (item.type === 'official') hasOfficial = true;
      else if (item.type === 'agency') hasAgency = true;
      else if (item.type === 'financial') hasFinancial = true;
      else if (item.type === 'proposal') hasProposal = true;
    }
  }

  const out = new Set<string>();

  if (hasOfficial || hasFinancial) out.add('donation');

  if (hasOfficial || hasProposal) {
    out.add('vote_yes');
    out.add('vote_no');
    out.add('vote_abstain');
    out.add('nomination_vote_yes');
    out.add('nomination_vote_no');
    out.add('co_sponsorship');
  }

  if (hasOfficial || hasAgency) {
    out.add('oversight');
    out.add('appointment');
  }

  if (hasOfficial || hasFinancial) out.add('revolving_door');

  if (userNodeVisible) out.add('alignment');

  return out;
}

/**
 * One-line explanation of *why* a connection type is not applicable to the
 * current focus. Returned reason is short enough to fit as a row subtitle.
 */
export function inapplicableReason(connectionType: string): string {
  if (connectionType === 'donation') {
    return 'Add an official or PAC to enable';
  }
  if (
    connectionType === 'vote_yes' ||
    connectionType === 'vote_no' ||
    connectionType === 'vote_abstain' ||
    connectionType === 'nomination_vote_yes' ||
    connectionType === 'nomination_vote_no' ||
    connectionType === 'co_sponsorship'
  ) {
    return 'Add an official or proposal to enable';
  }
  if (connectionType === 'oversight' || connectionType === 'appointment') {
    return 'Add an official or agency to enable';
  }
  if (connectionType === 'revolving_door') {
    return 'Add an official or corporation to enable';
  }
  if (connectionType === 'alignment') {
    return 'Show YOU node to enable';
  }
  return 'Not applicable to current focus';
}
