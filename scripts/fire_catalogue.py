#!/usr/bin/env python3
"""Shared classification for supplier catalogue harvests.

Every supplier names its categories differently -- one calls a combined device
"Beacons and Sounders", another "Combination Strobes", a third files it under a
panel family. Rather than write that mapping once per supplier, each harvest
hands its text here and gets back the app's own category.

The product's own name is read before any supplier-supplied category, because
merchandising paths are unreliable: Honeywell files a keychain under
control-panels. Order matters throughout -- "detector test kit" is a tool, and
"detector base" is a base, so both are matched before the bare word "detector".
"""
import re

# Honeywell's merchandising path is unreliable on its own: a keychain sits under
# control-panels, and gas controllers under the same. The product's own name is
# much better evidence, so it is read before the path is trusted. Ordered, most
# specific first -- "detector test kit" is a tool, not a detector.
NAME_RULES = [
    (r"\btest (kit|gas|lamp|magnet)|\bdetector tester|\btest pole|removal tool|\btester\b", ("tool", "Test equipment")),
    (r"\bkeychain|\blanyard|\bhi-?vis|\bsafety vest\b|\bwarden cap\b", ("other", "Merchandise")),
    (r"\btraining\b|\bcourse\b|\bclassroom\b|\bsoftware licen[cs]e", ("other", "Service or licence")),
    (r"\bback ?box|\bmounting (box|block|bracket|kit|plate|chassis)|\bchassis\b|\bsurface box|\benclosure|\bcabinet|\bbackbox|\bdoor kit|\btrim ring|\bblank(ing)? plate", ("accessory", "Enclosure or mounting")),
    (r"\bcable (gland|tie|clip|entry|cleat|marker)\b|\bp-?clip\b|\bcable saddle\b", ("accessory", "Cable fixing")),
    (r"\b(fire ?rated|twin core|multicore|screened|elv|data|ribbon) cable\b|\bfire ?rated .*\bcore\b|\bcable,? \d|\bcable roll\b|\bwiring loom\b|\bharness\b", ("cable", None)),
    (r"\bsampling pipe|\bpipe fitting|\bcapillary|\bair sampling point", ("aspirating", "Pipework")),
    (r"\baspirat|\bvesda|\bfaast\b|\bstratos\b", ("aspirating", None)),
    (r"\bbeam detector|\breflector\b|\bosid\b", ("beam", None)),
    (r"\b(gas|oxygen|toxic|lel|voc|pid|combustible) (detector|sensor|monitor)|\bgas detection|\bexplosion proof|\bsensepoint|\btouchpoint|\bsearchpoint|\bimpulse\b|\braevert|\bareara?e\b|\bmultirae|\bminirae|\bultrarae", ("other", "Gas detection")),
    (r"\bmanual call point|\bpull station|\bbreak ?glass|\bmcp\b", ("mcp", None)),
    (r"\bisolator\b", ("isolator", None)),
    (r"\b(monitor|control|relay|input|output|zone|interface|network|loop) module\b|\bmodule,|\bncm-|\bnotifier network", ("module", None)),
    (r"\bdetector base|\b(relay|isolator|sounder|standard|conventional|addressable|low ?profile) base\b|\bbase,? (standard|relay|isolator|sounder)|\bmounting base|\bb\d{3}[a-z]*\b base", ("base", None)),
    (r"\bduct (detector|housing|smoke)", ("detector", "Duct")),
    (r"\b(photo|photoelectric|optical|ionisation|ionization|multi-?criteria|multi-?sensor|heat|thermal|flame|smoke) (detector|sensor|alarm)|\bdetector,? (photo|heat|smoke|multi)", ("detector", None)),
    # Passive and mechanical protection. A distributor's catalogue is mostly
    # this, where a panel manufacturer's is none of it.
    (r"\bfire extinguisher\b|\bextinguisher\b|\bco2 \d|\bdry chemical powder\b|\bfoam \d+ ?l\b", ("extinguisher", None)),
    (r"\bhose ?reel\b|\blay ?flat hose\b", ("hose-reel", None)),
    (r"\bhydrant\b|\bstorz\b|\blandin ?g valve\b|\bbooster (assembly|inlet|cabinet)", ("hydrant", None)),
    (r"\bsprinkler\b|\bflow switch\b|\btamper switch\b|\balarm valve\b|\bdeluge\b", ("sprinkler", None)),
    (r"\bexit sign\b|\bemergency (light|luminaire|exit)|\bspitfire\b|\brecess adaptor\b", ("emergency-lighting", None)),
    (r"\bsign\b|\bsignage\b|\blabel\b|\bwarning sign", ("signage", None)),
    (r"\bfire blanket\b|\bfire door\b|\bdoor (holder|closer|release)\b|\bmag ?lock\b", ("ancillary", "Door hardware")),
    (r"\bwarden intercom|\bwip (phone|point|handset)\b|\bhandset\b", ("wip", None)),
    (r"\bevacuation (panel|system)\b|\bewis\b|\bmecp\b|\bemergency warning\b", ("ewis", None)),
    (r"\bdetector\b|\bdetection head\b", ("detector", None)),
    (r"\b(sounder|horn|speaker|loudspeaker) ?/? ?(strobe|beacon)|\bcombination strobe|\baudible (and|&) visual|\bsounder ?\+ ?(strobe|beacon)", ("sounder-strobe", None)),
    (r"\bstrobe\b|\bbeacon\b|\bvisual (alarm|indicator|signal)", ("strobe", None)),
    (r"\bsounder\b|\bhorn\b|\bbell\b|\b(loud)?speaker\b|\bsiren\b", ("sounder", None)),
    (r"\bbatter(y|ies)\b|\bsla\b|\b\d+ ?ah\b", ("battery", None)),
    (r"\bpower supply|\bcharger\b|\bpsu\b|\btransformer\b", ("power-supply", None)),
    (r"\bannunciator|\bkeypad\b|\bmimic (panel|display)|\brepeater (panel|display|unit)\b|\bdisplay (unit|panel|module)\b", ("ancillary", "Annunciator")),
    (r"\b(control|fire alarm|releasing|addressable|conventional) panel\b|\bfacp\b|\bpanel,? ", ("panel", None)),
    # Generic last resorts. Everything specific has already had its turn, so a
    # bare "module" here really is an unqualified module.
    (r"\bmodule\b|\b(relay|zone|interface|expander|extender) card\b", ("module", None)),
    (r"\bbase\b", ("base", None)),
    (r"\bcable\b|\bwire\b|\bflex\b", ("cable", None)),
]
NAME_RULES = [(re.compile(p, re.I), v) for p, v in NAME_RULES]

# SKU descriptions are sometimes just the category word, which makes a useless
# name. Fall back to the product family name in that case.
JUNK_NAME = re.compile(r"^(accessor(y|ies)|parts?( & accessories)?|spares?|other|misc(ellaneous)?|n/?a)$", re.I)


# Supplier category names, checked only after the name rules have had their
# turn. Substring match, longest first, so "Aspirating Detectors" is not caught
# by "Detectors".
CATEGORY_HINTS = [
    ("aspirating", ("aspirating", None)),
    ("beam", ("beam", None)),
    ("manual call point", ("mcp", None)),
    ("call point", ("mcp", None)),
    ("pull station", ("mcp", None)),
    ("ewis", ("ewis", None)),
    ("evacuation", ("ewis", None)),
    ("warden intercom", ("wip", None)),
    ("wip", ("wip", None)),
    ("emergency light", ("emergency-lighting", None)),
    ("exit sign", ("emergency-lighting", "Exit sign")),
    ("extinguisher", ("extinguisher", None)),
    ("hose reel", ("hose-reel", None)),
    ("hydrant", ("hydrant", None)),
    ("sprinkler", ("sprinkler", None)),
    ("sign", ("signage", None)),
    ("label", ("signage", "Label")),
    ("beacon", ("sounder-strobe", None)),
    ("sounder", ("sounder", None)),
    ("strobe", ("strobe", None)),
    ("isolator", ("isolator", None)),
    ("module", ("module", None)),
    ("base", ("base", None)),
    ("batter", ("battery", None)),
    ("power suppl", ("power-supply", None)),
    ("test", ("tool", "Test equipment")),
    ("cabl", ("cable", None)),
    ("fire rated", ("cable", None)),
    ("panel", ("panel", None)),
    ("detector", ("detector", None)),
    ("cover", ("accessory", "Cover")),
    ("accessor", ("accessory", None)),
    ("fitting", ("accessory", "Fittings")),
]
CATEGORY_HINTS.sort(key=lambda kv: -len(kv[0]))

TAG = re.compile(r"<[^>]+>")

# Placeholder-looking part numbers we refuse to ship: a fabricated part number
# sends someone to order the wrong thing.
BAD_PART = re.compile(r"^(n/?a|tbc|tba|unknown|various|contact|-+|\?+)$", re.I)


def clean(text):
    if not text:
        return None
    t = TAG.sub(" ", str(text))
    t = re.sub(r"&nbsp;?", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None



def classify(text, categories=(), body=None, fallback=("other", None)):
    """Category for a product.

    The name is read first because it is short and specific. A supplier's own
    category names come next. The full description is consulted last and only
    if nothing else matched: it carries marketing copy, compatibility notes and
    a downloads list, so a rule that fires on it fires on half the catalogue.
    """
    for pat, cat in NAME_RULES:
        if pat.search(text or ""):
            return cat
    joined = " ".join(c for c in categories if c).lower()
    for frag, cat in CATEGORY_HINTS:
        if frag in joined:
            return cat
    if body:
        for pat, cat in NAME_RULES:
            if pat.search(body):
                return cat
    return fallback
