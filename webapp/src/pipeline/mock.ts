import type { Insight, StepDef, StepId } from "./types"

/** All mock data lives here, so the demo case works fully offline. */
export const MOCK = {
  ref: "SP-2026-0417",
  sample: { contact: "Claire Moret", company: "Valtherm Composants SA", address: "Rue de l'Industrie 21, 1950 Sion" },
  coords: { lon: 7.36333, lat: 46.22724, label: "Valais (VS)", cantonId: 23 },
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