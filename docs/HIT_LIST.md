

## Brainstorming Ideas







## BUGS — Fix These First

- On several pages, after clicking an something
POST
	http://127.0.0.1:3000/api/platform/web-vitals
Status
400

- pnpm dev Warning: <w> [webpack.cache.PackFileCacheStrategy] Serializing big strings (140kiB) impacts deserialization performance (consider using Buffer instead and decode when needed)


---

## GENERAL / CROSS-CUTTING

- brainstorm dropdowns on top Nav Bar
ex:     -initiatives        -officials
            -bills              -congress
            -regulations        -house
            -executive orders   -local
            -local              -my officials


---

## HOMEPAGE

- Brainstorm Layout Update - Political ads (video) and discussion (+ratings?) - strategy
- Remove the 2 buttons directly under search bar
- Remove the 'browse comment periods' banner
- District Boundary Data needed
- connection graph - small lightweight interactive graph banner instead of just the button

---

## OFFICIALS
- Federal vs State tag on the officials list
- Bills in graph shows IDs, not names
- Procedural votes should be filtered by default (can be unfiltered manually)


---

## PROPOSALS


---

## PROPOSALS [ID]


---

## INITIATIVES


---


## INTIIATIVES [ID]

- Make a "status" section and place below the initiative text - make it collapsible and place the quality gate section inside of the status - also plan for different status messages for each stage of the initiative
- Comments filterable by user type/location/verified

## CIVIC INITIATIVES


---

## AGENCIES


---

## GRAPH

- By state group not working
- Initial Settings clickable in the middle of a 'blank' inital state with a 'make your own graph' tutorial button that walks user through how to add entities and connections and option to hide 
- The settings still needs some work - Brainstorm session - probably a spec file
        -- auto populate available connections
        -- options for node size
        -- Indentation of the heirarchies is inconsistent 
        -- Go though the d3 documentation / brainstorm additional options
        -- probably lots i am forgetting so add your own ideas as you see fit
        -- maybe a 'build a custom group' option


---

## DASHBOARD


---

## Account/Profile

- Unique Display Name (Default: User1234)
- Presets
- Positions / Following / Comments

---

## INFRASTRUCTURE & PERFORMANCE

- Data Integrity, some issues discovered - some states don't have 2 senators - suspect incorrect house members as well

---

## COMMUNITY & AUTH


---

## DOCUMENTATION (Open Source Readiness)