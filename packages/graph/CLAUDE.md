# packages/graph/CLAUDE.md

## Purpose
The connection graph is not a feature — it IS the core product of Civitics. Every journalist who uses it to break a story, every citizen who shares a screenshot, every researcher who embeds it in an article is the mission made tangible. Build it accordingly.

## The One Rule
The graph must be beautiful enough to screenshot, powerful enough to investigate, simple enough for anyone, and deep enough for experts.

## Technology
- D3 force simulation — non-negotiable, never replace with React Flow or Cytoscape
- The organic force clustering IS the analysis — dense clusters mean deep entanglement
- Bridge nodes reveal hidden connections — this insight only exists with real force simulation
- WebGL upgrade path (Sigma.js/Pixi.js) when graphs exceed 500 nodes — Phase 3+

## File Structure
packages/graph/
  src/
    ForceGraph.tsx          — core D3 component, all rendering logic
    GraphControls.tsx       — preset, filter, and customization panel
    GraphToolbar.tsx        — top bar: share, screenshot, AI narrative, zoom
    GraphLegend.tsx         — node shapes and edge colors explained
    SharePanel.tsx          — share code generation and copy/embed options
    ScreenshotPanel.tsx     — export options: PNG, SVG, PDF
    AiNarrative.tsx         — AI explanation panel
    PathFinder.tsx          — find connection between any two entities
    TimelineScrubber.tsx    — animate graph through time
    ComparisonMode.tsx      — split screen two entities
    types.ts                — all TypeScript types for graph
    utils/
      layout.ts             — force simulation parameters
      colors.ts             — node and edge color system
      serialize.ts          — graph state to JSON to share code
      screenshot.ts         — html2canvas/dom-to-image utilities
      clustering.ts         — cluster detection algorithms

## Node Types and Visual Language

### Shapes (never change these — visual consistency matters)
  Official      → Circle (photo if available, initials if not)
  Agency        → Rounded rectangle
  Proposal/Bill → Document rectangle (folded corner)
  Financial     → Diamond
  Organization  → Hexagon
  Court         → Scale/balance icon
  Corporation   → Square with rounded corners

### Node Size (default: connection count)
  Base size per type:
    Official:     24px radius
    Agency:       20px radius
    Proposal:     18px radius
    Financial:    16px radius

  Scale formula:
    radius = base + Math.sqrt(connectionCount) * 2

  User can change size encoding to:
    connection_count (default)
    donation_total
    votes_cast
    bills_sponsored
    years_in_office
    uniform

### Node Color (default: entity type)
  Official border:
    Democrat:     #2563eb (blue)
    Republican:   #dc2626 (red)
    Independent:  #7c3aed (purple)
    Other:        #d97706 (amber)

  Agency:         #6b7280 (gray border)
  Proposal:       #f59e0b (amber border)
  Financial:      #16a34a (green border)
  Corporation:    #0891b2 (cyan border)

  User can change color encoding to:
    entity_type (default)
    party_affiliation
    industry_sector
    state_region
    single_color

## Edge Types and Visual Language

### Connection Types
  donation          → green   #16a34a  solid
  vote_yes          → blue    #2563eb  solid
  vote_no           → red     #dc2626  solid
  co_sponsor        → blue    #3b82f6  dashed
  appointment       → purple  #7c3aed  dashed
  revolving_door    → orange  #ea580c  solid
  oversight         → gray    #6b7280  solid
  investigated_by   → pink    #be185d  solid
  lobbied_for       → amber   #f59e0b  dashed
  formerly_employed → orange  #ea580c  dashed

### Edge Thickness
  Donation edges: proportional to log(amount)
    formula: Math.max(1, Math.log10(amountCents / 100000))
    $10k donation  = 1px
    $100k donation = 2px
    $1M donation   = 3px
    $10M donation  = 4px

  All other edges: 2px uniform

  User can change to:
    amount_proportional (default for donations)
    strength_proportional
    uniform

### Edge Opacity
  Opacity = connection strength (0.3 minimum)
  Stronger connections more visible
  Weak connections fade into background

## Preset Views

### Built-in Presets (never remove these)

  Follow the Money:
    filters: ['donation']
    nodeSize: 'donation_total'
    nodeColor: 'entity_type'
    description: "Who funds this official and how much"

  Votes and Bills:
    filters: ['vote_yes', 'vote_no', 'co_sponsor', 'proposal']
    nodeSize: 'bills_sponsored'
    nodeColor: 'party_affiliation'
    description: "Legislative patterns and alliances"

  The Revolving Door:
    filters: ['revolving_door', 'formerly_employed', 'appointment']
    nodeSize: 'connection_count'
    nodeColor: 'entity_type'
    description: "Movement between government and industry"

  Committee Power:
    filters: ['oversight', 'appointment']
    nodeSize: 'years_in_office'
    nodeColor: 'entity_type'
    description: "Who controls what and who appointed them"

  Industry Capture:
    filters: ['donation', 'lobbied_for', 'revolving_door']
    nodeSize: 'donation_total'
    nodeColor: 'industry_sector'
    description: "Industry influence on this official"

  Co-Sponsor Network:
    filters: ['co_sponsor', 'vote_yes']
    nodeSize: 'bills_sponsored'
    nodeColor: 'party_affiliation'
    description: "Who works across the aisle"

  Full Picture:
    filters: ['all']
    description: "Every connection type visible"

  Clean View:
    filters: ['all']
    minStrength: 0.7
    verifiedOnly: true
    description: "High-confidence connections only"

### Community Presets
  Users can save named presets
  Stored in graph_presets table:
    id, user_id, name, description,
    config JSONB, use_count, is_public

  Public presets browseable
  Platform features most-used

## Graph State Serialization
Every graph state serializes to JSON for share codes:

{
  "version": "1.0",
  "centerEntity": { "type": "official", "id": "uuid" },
  "depth": 2,
  "filters": {
    "connectionTypes": ["donation", "vote_yes"],
    "minStrength": 0.3,
    "minAmountCents": 0,
    "dateRange": { "start": null, "end": null },
    "verifiedOnly": false
  },
  "visual": {
    "nodeSize": "connection_count",
    "nodeColor": "entity_type",
    "edgeThickness": "amount_proportional",
    "theme": "light",
    "layout": "force_directed"
  },
  "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
  "pinnedNodes": [],
  "annotations": [],
  "preset": "follow_the_money"
}

Share codes stored in graph_snapshots table:
  id UUID
  code TEXT — format: CIV-XXXX-XXXX
    generated from:
    "CIV-" + randomChars(4) + "-" + entityNameSlug.slice(0,8).toUpperCase()
  state JSONB — full serialized state above
  created_by UUID nullable
  created_at TIMESTAMPTZ
  view_count INTEGER default 0
  title TEXT nullable — user can name their graph

URL pattern: civitics.com/graph/CIV-X7K2-WARREN

## Screenshot System
Uses html2canvas for PNG export
Uses inline SVG serialization for SVG export
Uses jsPDF for PDF export

### Watermark (always included, non-removable)
  Position: bottom right corner
  Content:
    civitics.com/graph/[SHARE_CODE]
    Data: [source list e.g. FEC, Congress.gov]
    Generated: [date]

  The URL watermark is strategic:
  Every shared screenshot drives
  new users back to the platform.
  This is the single most important
  user acquisition mechanic.

### Export Options
  Format: PNG, SVG, PDF report
  Size: 1x, 2x (retina), 4x (print)
  Theme override for export:
    current, light, dark, print
  Include options:
    legend (default on)
    title (default on)
    watermark (always on, non-removable)
    AI narrative (PDF only)
    share code (default on)

## AI Narrative
Triggered by "Explain This Graph" button
Uses Claude API (claude-sonnet-4-6 model)
Costs 1 civic credit per generation
Results cached per graph state hash

### Prompt Structure
System:
  "You are a civic accountability analyst
   explaining government connection graphs
   to citizens. Be factual, neutral, and
   specific. Highlight patterns that matter."

User:
  "Analyze this graph state:
   [serialized graph summary]

   Visible nodes: [list with types]
   Visible edges: [list with amounts]
   Active preset: [preset name]

   Provide:
   1. What this graph shows (2 sentences)
   2. Key patterns (3 bullet points)
   3. Most significant single connection
   4. Suggested next investigation steps"

### Tone Options
  neutral:       facts only, no interpretation
  investigative: highlight unusual patterns
  educational:   explain what connections mean

## Force Simulation Parameters

### Default Values (tuned for civic data)
  charge strength: -300 - (connectionCount * 50)
    more connected = stronger repulsion
    creates natural spacing

  link distance: 150 - (strength * 100)
    stronger connections = nodes closer

  link strength: strength * 0.5

  collision radius: nodeRadius + 10
    prevents overlap

  center force: width/2, height/2
    gentle pull toward center

  alpha decay: 0.0228 (default D3)
  velocity decay: 0.4

### Layout Presets
  force_directed:
    organic clustering (default)
    uses params above

  radial:
    center node fixed at center
    other nodes on expanding rings
    ring distance based on hop count

  hierarchical:
    y position based on power/seniority
    x position based on party/type

  circular:
    all nodes on circle perimeter
    edges drawn inside

## Performance Rules
  Under 100 nodes:  standard SVG rendering
  100-500 nodes:    optimize with canvas
  500+ nodes:       WebGL via Sigma.js (Phase 3)

  Always:
    Debounce filter changes 150ms
    Cache fetched connections per entity
    Do not re-fetch if already in state
    Freeze simulation when not visible
    requestAnimationFrame for all animation

## Interaction Patterns

### Click Behaviors
  Single click node:
    Select node
    Highlight connected edges
    Fade unconnected nodes
    Show entity panel (right side)

  Double click node:
    Expand — fetch and add this node's
    connections to current graph
    New nodes fly in from clicked position

  Click background:
    Deselect everything
    Reset all opacity

  Click edge:
    Show edge detail panel:
      Connection type
      Amount/strength
      Date range
      Evidence sources
      Link to source documents

### Hover Behaviors
  Hover node:
    Show tooltip:
      Entity name
      Type
      Key stat (top donor amount or total votes)
    Highlight connected edges
    Fade unconnected nodes
    Show edge labels for this node's connections

  Hover edge:
    Show edge label always
    Highlight connected nodes
    Show tooltip:
      Connection type
      Amount or description
      Date

### Drag Behaviors
  Drag node:
    Node follows cursor
    Simulation continues
    Node stays where dropped
    Does not snap back — feels like Obsidian

  Drag background:
    Pan the viewport

### Zoom Behaviors
  Scroll:                zoom in/out
  Double click background: zoom to fit
  Pinch (mobile):        zoom
  Ctrl+scroll:           zoom
  Min zoom: 0.1
  Max zoom: 8.0

## Path Finder
Finds shortest connection path between
any two entities using PostgreSQL
recursive CTE query.

UI:
  "From" entity search box
  "To" entity search box
  "Find Path" button

  Result: highlighted path on graph
  Entity A → Connection → Entity B
    → Connection → Entity C

  Readable text result:
  "Senator Smith → donated to →
   PharmaPAC → funded → PharmaCorp
   in 2 hops"

  Max hops: 6 (performance limit)
  If no path found:
    "No connection found within 6 degrees"

## Timeline Scrubber
Shows how network evolved over time.

UI:
  [2010 ━━━━━━●━━━━━━━━━━━ 2026]
  Play button with speed control: 1x 2x 5x

Behavior:
  Filter edges to show only connections
  that existed at or before selected date

  Nodes appear/disappear as officials
  come and go from office

  Edge thickness grows as
  donations accumulate over time

  Simulation gently re-settles
  after each time change

  Key events marked on timeline:
    Elections marked with triangle
    Major legislation marked with circle
    Indictments/investigations marked with !

## Comparison Mode
Split screen two entities side by side.

UI:
  "Compare Mode" button in toolbar
  Opens second graph panel
  Each panel has own entity selector

  Shared controls:
    Same preset applied to both
    Same date range

  Independent per panel:
    Each can be panned separately
    Each shows own entity

  Shared node highlighting:
    Entities in both graphs glow/pulse
    "12 shared donors" indicator shown

## Collaboration Features (Phase 3)

### Annotations
  Click any node or edge
  Add text note
  Visibility options: private / link-only / public
  Stored in graph_annotations table
  Shown as small icon on graph
  Hover to read full note

### Investigation Rooms
  Create shared investigation
  Invite collaborators by email or share link
  Real-time collaboration via Supabase Realtime
  See other users' cursors on graph
  Shared annotation layer
  Chat panel alongside graph

### Community Findings
  Publish completed investigation publicly
  Includes: graph state, annotations,
    AI narrative, evidence links
  Community validation and upvoting
  Platform features best findings
  "Verified Investigation" badge from platform team

## Database Tables Required

### graph_snapshots (share codes)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  code TEXT UNIQUE NOT NULL
  state JSONB NOT NULL
  title TEXT
  created_by UUID REFERENCES users(id)
  created_at TIMESTAMPTZ DEFAULT NOW()
  view_count INTEGER DEFAULT 0
  is_public BOOLEAN DEFAULT true

### graph_presets (community presets)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  user_id UUID REFERENCES users(id)
  name TEXT NOT NULL
  description TEXT
  config JSONB NOT NULL
  use_count INTEGER DEFAULT 0
  is_public BOOLEAN DEFAULT false
  created_at TIMESTAMPTZ DEFAULT NOW()

### graph_annotations (Phase 3)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  snapshot_id UUID REFERENCES graph_snapshots(id)
  entity_id UUID
  entity_type TEXT
  note TEXT NOT NULL
  visibility TEXT DEFAULT 'private'
  created_by UUID REFERENCES users(id)
  created_at TIMESTAMPTZ DEFAULT NOW()

## What Not To Do
- Never use React Flow — D3 force simulation only
- Never show blockchain addresses or transaction hashes in UI
- Never make the screenshot watermark removable
- Never auto-play the timeline on page load (disorienting)
- Never fetch all connections at once for large entities
  (paginate and expand on demand)
- Never re-fetch connections already loaded in graph state
- Never block the UI during simulation settling
  (run simulation asynchronously)
- Never use more than 6 colors in a single graph view
  (visual noise kills insight)
- Never remove empty state messaging
  (users need to know why graph is sparse)
- Never skip loading skeleton states
  (graph appearing suddenly is jarring)
- Never store full document text in graph state
  (store IDs and fetch on demand)

## The North Star
Every feature in this package should
answer yes to this question:

"Does this help a citizen, journalist,
or researcher see a connection they
couldn't see before?"

If yes — build it.
If no — don't.

The screenshot watermark with share code URL
is the single most strategically important
feature in this package. It turns every
shared image into a user acquisition event.
Build it before anything else.
