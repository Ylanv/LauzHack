import type { Insight, StepDef, StepId } from "./types"

/** All mock data lives here, so the demo case works fully offline. */
export const MOCK = {
  sample: { contact: "Marie Dupont", company: "CMDS SA", address: "Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates", industry: "metalworking" },
  coords: { lon: 6.109486, lat: 46.166565, label: "Geneva (GE)", cantonId: 25 },
  // dur is simulated seconds; steps with the same start run in parallel
  steps: [
    { id: "identity", label: "Checking the company", sub: "Commercial register and federal address register", start: 0, dur: 2.6 },
    { id: "building", label: "Reading the building record", sub: "Federal building register and 3D model", start: 4.0, dur: 4.5 },
    { id: "hazard", label: "Checking natural hazards", sub: "Runoff, hail and earthquake zone", start: 4.4, dur: 5.5 },
    { id: "aerial", label: "Looking at the roof", sub: "Aerial image of the site", start: 9.9, dur: 5.0 },
    { id: "industry", label: "Reading public information", sub: "The company's own website and documents", start: 10.2, dur: 4.8 },
    { id: "file", label: "Putting the file together", sub: "Every item keeps its source", start: 15.0, dur: 3.0 },
  ] as StepDef[],
  speech: { identity: "Finding your company.", building: "Now the building.", hazard: "Checking the hazard maps.", aerial: "Looking at the roof.", file: "Almost done.", done: "Sent!" } as Partial<Record<StepId | "done", string>>,
}

/** Findings shown on the map as steps return. Illustrative until driven by real vector-tile queries. */
export const INSIGHTS: Insight[] = [
  { id: "bld", at: ["building", 0.85], kind: "building", e: 52, n: 0, dx: 20, dy: -120, kicker: "Building register", title: "Neighbouring building, about 8 m away", note: "Relevant for fire spread between structures." },
  { id: "road", at: ["hazard", 0.25], kind: "road", e: 300, n: 365, dx: 30, dy: -30, kicker: "Access", title: "Main road about 300 m north", note: "Fire brigade access is straightforward." },
  { id: "river", at: ["hazard", 0.5], kind: "river", e: -380, n: -555, dx: 30, dy: 20, kicker: "Water", title: "The Rhône runs about 520 m south", note: "Flood and runoff exposure to be confirmed on the hazard map." },
  { id: "wood", at: ["hazard", 0.8], kind: "forest", e: -190, n: 160, dx: -250, dy: -90, kicker: "Vegetation", title: "Wooded area close to the west", note: "Worth a look for wildfire and storm-damage exposure." },
  { id: "site", at: ["industry", 0.6], kind: "info", kicker: "Public information", title: "Company website lists this address", note: "Source: company website, not the building register." },
]

/** Used only in the explicit demo flow (no backend). Same keys and labels as the backend's GET /api/industries. */
export const DEMO_INDUSTRIES = [
  ["woodworking", "Woodworking / carpentry / joinery"], ["metalworking", "Metalworking / machining / locksmith"],
  ["surface_treatment", "Surface treatment / electroplating / industrial painting"], ["bakery_food", "Bakery / pastry / food production"],
  ["meat_dairy", "Meat / dairy / cheese processing"], ["printing", "Printing / packaging"], ["car_repair", "Car repair / body shop"],
  ["plastics_chemicals", "Plastics / chemicals"], ["warehouse_logistics", "Warehouse / logistics"],
  ["precision_electronics", "Watchmaking / precision / electronics"], ["textile", "Textile / laundry / dry cleaning"], ["other", "Other industrial or craft activity"],
].map(([key, label]) => ({ key, label }))