"""Insurance value (valeur à neuf / replacement value) = building volume × price per m³. 0 LLM token.

Geneva: no compulsory cantonal building insurance (private market). Insurers insure at REPLACEMENT VALUE
(SIA general conditions), estimated from the SIA 416 volume × a unit price per m³ by building type, and
indexed every year on the Geneva construction price index (ASA circular RS FKS 01: GE 2025 = 161.8, base 1988;
OCSTAT publishes the index twice a year). The unit prices below are ASSUMPTIONS to be replaced by AXA's grid.

Volume (SIA 416), in order of preference:
  1. RegBL gvol (declared volume)
  2. RegBL gebf (energy reference floor area) × storey height
  3. AV footprint × RegBL floors × storey height
  4. AV footprint × floors observed by vision × storey height  (observed → wider range)

Prices: HARDCODED indicative CHF/m³ ranges per building class (RegBL gklas), excluding land and machinery.
They are assumptions for a pre-underwriting order of magnitude and MUST be validated with AXA
(cantonal building insurers publish their own m³ tariffs).
"""

# gklas → (label, low CHF/m³, high CHF/m³, storey height m)
PRICES = {
    1110: ("single-family house", 750, 1050, 3.0),
    1121: ("two-family house", 750, 1050, 3.0),
    1122: ("apartment building", 750, 1000, 3.0),
    1130: ("residential (community)", 750, 1000, 3.0),
    1211: ("hotel", 850, 1200, 3.2),
    1212: ("short-stay accommodation", 750, 1050, 3.0),
    1220: ("office building", 800, 1150, 3.5),
    1230: ("retail / wholesale", 650, 950, 4.0),
    1231: ("restaurant / bar", 800, 1100, 3.5),
    1241: ("transport / communications", 500, 800, 4.5),
    1242: ("garage / parking", 350, 600, 3.0),
    1251: ("industrial building", 400, 700, 5.0),
    1252: ("tank / silo / warehouse", 250, 450, 6.0),
    1261: ("culture / leisure", 750, 1100, 4.0),
    1262: ("museum / library", 850, 1200, 4.0),
    1263: ("school / university", 800, 1100, 3.5),
    1264: ("hospital / clinic", 1000, 1400, 3.5),
    1265: ("sports hall", 600, 900, 7.0),
    1271: ("agricultural building", 200, 400, 5.0),
    1272: ("church / religious", 800, 1200, 6.0),
    1274: ("other non-residential", 450, 750, 4.0),
}
DEFAULT = ("non-residential (class unknown)", 400, 900, 4.0)  # wide on purpose


def estimate(regbl: dict, footprint_m2: float | None = None, observed_floors: int | None = None) -> dict:
    label, low, high, storey = PRICES.get(regbl.get("gklas"), DEFAULT)
    floors = regbl.get("gastw")
    volume, method, widen = None, None, 1.0
    if regbl.get("gvol"):
        volume, method = float(regbl["gvol"]), "building volume (RegBL gvol or Geneva cadastre footprint x height)"
    elif regbl.get("gebf"):
        volume, method = regbl["gebf"] * storey, f"RegBL energy reference area × {storey} m"
    elif footprint_m2 and floors:
        volume, method = footprint_m2 * floors * storey, f"AV footprint × {floors} floors (RegBL) × {storey} m"
    elif footprint_m2 and observed_floors:
        volume, method, widen = footprint_m2 * observed_floors * storey, f"AV footprint × {observed_floors} floors (observed) × {storey} m", 1.25

    if not volume:
        return {"best_estimate_chf": None, "low_chf": None, "high_chf": None, "status": "not_estimated", "method": None,
                "explanation": "No volume, floor area or number of floors available."}
    lo, hi = volume * low / widen, volume * high * widen
    return {
        "best_estimate_chf": round((lo + hi) / 2, -4),
        "low_chf": round(lo, -4),
        "high_chf": round(hi, -4),
        "status": "derived_calculation",
        "method": f"{method} = {volume:,.0f} m³ × CHF {low}–{high}/m³ ({label})",
        "explanation": "Estimated cost to rebuild the building after a loss = what the insurer pays at replacement value "
                       "(valeur à neuf) and the basis of the sum insured (too low a sum = underinsurance, pro-rata indemnity). "
                       "Excl. land, machinery and stock; if not rebuilt, indemnity is usually limited to the current value. "
                       "Unit prices to calibrate on AXA's m³ grid, indexed on the Geneva construction price index (2025: 161.8, base 1988).",
    }
