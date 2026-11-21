"""Industry type declared by the client (form drop-down) → typical fire-relevant processes.

The client knows its own trade: asking it is more reliable than guessing it. The typical hazards below are
used as `inferred` evidence only when no direct evidence (register, permit, website, image) exists.
"""

# key: (label, typical processes, high_temperature, typical_gas_use, typical_flammables)
INDUSTRIES = {
    "woodworking":         ("Woodworking / carpentry / joinery", "sawing, sanding, varnishing", False, None,
                            "wood stock, wood dust, varnishes"),
    "metalworking":        ("Metalworking / machining / locksmith", "welding, cutting, machining", True,
                            "welding gas bottles (oxy-acetylene)", "cutting oils, gas bottles"),
    "surface_treatment":   ("Surface treatment / electroplating / industrial painting", "plating baths, paint booth, curing ovens", True,
                            None, "solvents, paints, chemical baths"),
    "bakery_food":         ("Bakery / pastry / food production", "baking ovens, fryers", True, "gas ovens (frequent)",
                            "flour dust, cooking oils"),
    "meat_dairy":          ("Meat / dairy / cheese processing", "cooking, smoking, refrigeration", True, "gas boilers / smokehouse",
                            "refrigerants (ammonia), packaging"),
    "printing":            ("Printing / packaging", "printing presses, drying", False, None, "inks, solvents, paper stock"),
    "car_repair":          ("Car repair / body shop", "welding, paint booth, fuel handling", True, "welding gas bottles",
                            "fuels, oils, paints, tyres"),
    "plastics_chemicals":  ("Plastics / chemicals", "extrusion, moulding, mixing", True, None, "polymers, solvents, chemicals"),
    "warehouse_logistics": ("Warehouse / logistics", "storage, handling, forklift charging", False, None,
                            "stored goods, packaging, forklift batteries"),
    "precision_electronics": ("Watchmaking / precision / electronics", "micro-machining, soldering, cleaning", False, None,
                              "cleaning solvents, small chemicals"),
    "textile":             ("Textile / laundry / dry cleaning", "washing, drying, ironing", True, "gas dryers (sometimes)",
                            "textiles, cleaning solvents"),
    "other":               ("Other industrial or craft activity", None, False, None, None),
}


def typical(key: str | None) -> dict | None:
    if key not in INDUSTRIES:
        return None
    label, proc, ht, gas, flam = INDUSTRIES[key]
    return {"key": key, "label": label, "processes": proc, "high_temperature": ht, "gas": gas, "flammables": flam}
