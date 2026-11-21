"""Building age / condition and heating (fire-relevant) from RegBL codes. 0 LLM token.

- Age: gbauj (exact year) or gbaup (construction period, filled more often).
- Condition: client declaration if given (new / renovated / old), else an estimate from age + renovation signals
  (recent heating replacement with heat pump / district heating, solar panels seen by vision).
- Heating energy: gas / oil / wood in the building = fire-relevant fact from an official register.
"""

from datetime import date

# RegBL construction period codes (GBAUP) → (from, to)
PERIODS = {8011: (None, 1918), 8012: (1919, 1945), 8013: (1946, 1960), 8014: (1961, 1970), 8015: (1971, 1980),
           8016: (1981, 1985), 8017: (1986, 1990), 8018: (1991, 1995), 8019: (1996, 2000), 8020: (2001, 2005),
           8021: (2006, 2010), 8022: (2011, 2015), 8023: (2016, None)}

# RegBL heating energy source (GENH1)
ENERGY = {7500: "none", 7501: "air (heat pump)", 7510: "geothermal (heat pump)", 7511: "geothermal probe", 7512: "geothermal register",
          7513: "water (heat pump)", 7520: "gas", 7530: "heating oil", 7540: "wood", 7541: "wood (logs)", 7542: "wood (chips)",
          7543: "wood (pellets)", 7550: "waste heat", 7560: "electricity", 7570: "solar thermal", 7580: "district heating",
          7581: "district heating", 7582: "district heating", 7598: "undetermined", 7599: "other"}
# RegBL heat generator (GWAERZH1)
GENERATOR = {7400: "none", 7410: "heat pump", 7411: "heat pump (shared)", 7420: "solar thermal", 7430: "boiler", 7431: "boiler",
             7432: "condensing boiler", 7433: "boiler", 7434: "boiler", 7435: "stove", 7436: "individual stove", 7440: "CHP unit",
             7450: "central electric heating", 7451: "direct electric heating", 7460: "district heating exchanger", 7499: "other"}
FIRE_RELEVANT_ENERGY = {"gas", "heating oil", "wood", "wood (logs)", "wood (chips)", "wood (pellets)"}
MODERN = {"air (heat pump)", "geothermal (heat pump)", "geothermal probe", "geothermal register", "water (heat pump)",
          "district heating", "solar thermal"}


def _age(regbl):
    year = regbl.get("gbauj")
    if year:
        return year, year, "construction year (RegBL)"
    lo, hi = PERIODS.get(regbl.get("gbaup"), (None, None))
    if lo or hi:
        return lo, hi, "construction period (RegBL)"
    return None, None, None


def heating(regbl: dict) -> dict:
    energy = ENERGY.get(regbl.get("genh1"))
    upd = regbl.get("gwaerdath1")
    return {
        "energy_source": energy,
        "generator": GENERATOR.get(regbl.get("gwaerzh1")),
        "info_updated": upd if upd and upd != "-" else None,
        "fire_relevant": energy in FIRE_RELEVANT_ENERGY,
        "presence_status": "confirmed_present" if energy in FIRE_RELEVANT_ENERGY else ("unknown" if energy in (None, "undetermined") else "confirmed_absent"),
    }


def condition(regbl: dict, renovation_year: int | None = None, pv_seen: str | None = None) -> dict:
    lo, hi, basis = _age(regbl)
    this_year = date.today().year
    age_min = this_year - hi if hi else None
    age_max = this_year - lo if lo else None
    h = heating(regbl)
    signals = []
    try:
        upd_year = int((h["info_updated"] or "")[-4:])
    except ValueError:
        upd_year = None
    if h["energy_source"] in MODERN and upd_year and upd_year >= this_year - 15:
        signals.append(f"modern heating ({h['energy_source']}) recorded in {upd_year}")
    if pv_seen in ("confirmed_present", "possible"):
        signals.append("solar panels visible on the roof")
    if renovation_year:
        signals.append(f"last renovation declared: {renovation_year}")

    if age_max is not None and age_max <= 10:
        state, status = "new", "estimated"
    elif signals and (age_min or 0) > 25:
        state, status = "renovated (signals)", "estimated"
    elif age_min is not None and age_min > 40:
        state, status = "old", "estimated"
    elif age_min is not None:
        state, status = "intermediate", "estimated"
    else:
        state, status = "unknown", "unknown"
    return {
        "state": state, "status": status,
        "construction": {"from": lo, "to": hi, "basis": basis},
        "age_years": {"min": age_min, "max": age_max},
        "renovation_signals": signals,
        "last_renovation_year": renovation_year,
    }
