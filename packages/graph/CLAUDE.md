Read CLAUDE.md first.
Then read packages/graph/CLAUDE.md carefully.
That second file is the complete design
specification for the graph package.

Today we are building Phase 1 of the graph:

1. Wire real data from Supabase
   entity_connections table
   to the existing ForceGraph component
   replacing all placeholder/mock data

2. Build the share code system:
   - graph_snapshots table migration
   - serialize current graph state to JSON
   - generate CIV-XXXX-XXXX code
   - store in Supabase
   - URL: civitics.com/graph/[code]
   - load graph state from code on visit

3. Screenshot with watermark:
   - html2canvas for PNG capture
   - watermark bottom right:
     civitics.com/graph/[code]
     Data sources listed
     Date generated
   - 1x and 2x download options

4. Preset views:
   Follow the Money
   Votes & Bills
   The Revolving Door
   Full Picture
   Clean View
   
   As clickable buttons above graph
   Each instantly reconfigures
   visible edge types and
   node size encoding

Build in this exact order.
Share codes before screenshot.
Screenshot before presets.
Each step builds on the last.

Run pnpm build before pushing.
Update docs/PHASE_GOALS.md when done.