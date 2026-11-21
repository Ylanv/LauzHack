"""Simple company-website scraping. 0 LLM token (the LLM only reads the compact output).

1. Find the site: URL given by the user, else guess <name>.ch / .com from the registered name and
   accept it only if the page mentions the company or its postcode/town (avoids random domains).
2. Fetch the homepage + up to 4 internal pages whose URL/link text matches about/services/production keywords.
3. Keep: visible text (capped), sentences containing fire/industry keywords, up to 3 photos (no logos/icons).

Limits (assumed for the MVP): JavaScript-rendered sites return little text; no search engine.
"""

import html
import io
import re
from urllib.parse import urljoin, urlparse

import httpx

UA = {"User-Agent": "Mozilla/5.0 (compatible; axa-smart-property/0.1; property risk pre-underwriting)"}
_client = httpx.Client(timeout=15, headers=UA, follow_redirects=True)

LEGAL = r"\b(ag|sa|gmbh|s[àa]rl|sagl|ltd|inc|kg|genossenschaft|coop[ée]rative|in liquidation)\b"
PAGE_KW = re.compile(r"ueber|über|uber|about|unternehmen|firma|team|portrait|leistung|angebot|service|produkt|produktion|"
                     r"werkstatt|atelier|betrieb|entreprise|prestation|savoir|fabrication|chi-siamo|servizi|azienda|produzione", re.I)
# Fire / industrial exposure keywords (de / fr / it / en)
RISK_KW = re.compile(r"gas|ofen|öfen|four|forno|schweiss|soud|saldat|lack|spritz|peinture|vernis|vernic|lösungsmittel|solvant|solvent|"
                     r"chemi|holz|bois|legno|sägerei|scierie|späne|copeaux|druckerei|imprim|stampa|tank|citerne|lager|stockage|deposito|"
                     r"brennbar|inflammable|infiammabil|sprinkler|brandmelde|détection|backofen|friteuse|cnc|laser|härt|trempe|"
                     r"galvan|kunststoff|plastique|plastica|batterie|akku|lithium|photovolta|solar", re.I)
# Trade words are not proof that a page belongs to THIS company (boulangerie.com ≠ Boulangerie des Bergières).
GENERIC = {"schreinerei", "menuiserie", "falegnameria", "garage", "carrosserie", "carrozzeria", "metallbau", "serrurerie",
           "druckerei", "imprimerie", "tipografia", "bäckerei", "baeckerei", "boulangerie", "panetteria", "pasticceria",
           "malerei", "gipserei", "holzbau", "innenausbau", "bau", "construction", "constructions", "transport", "transports",
           "services", "service", "group", "gruppe", "groupe", "swiss", "suisse", "schweiz", "svizzera", "und", "et", "des",
           "der", "die", "das", "les", "the", "and", "von", "de", "du", "la", "le", "di", "fils", "söhne", "soehne"}
BAD_IMG = re.compile(r"logo|icon|sprite|favicon|avatar|flag|badge|banner-ad|\.svg|\.gif|pixel|tracking|placeholder", re.I)


def _text(page_html):
    t = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header)\b.*?</\1>", " ", page_html)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", t).strip()


def _ascii(s):
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("é", "e"), ("è", "e"), ("ê", "e"), ("à", "a"), ("â", "a"),
                 ("ç", "c"), ("ô", "o"), ("î", "i"), ("&", " "), ("+", " ")):
        s = s.replace(a, b)
    return s


def _tokens(name):
    words = [w for w in re.findall(r"[a-z0-9]+", _ascii(re.sub(LEGAL, " ", name.lower()))) if len(w) > 1]
    return words, [w for w in words if w not in GENERIC and len(w) > 2]


def _candidates(name):
    """Domain guesses, most specific first. Every guess must contain a distinctive word of the name."""
    words, distinct = _tokens(name)
    if not distinct:
        return []
    groups = [words, words[:2], distinct, distinct[:1] if len(distinct[0]) >= 5 else []]
    out = []
    for g in groups:
        if not g or not any(w in distinct for w in g):
            continue
        for b in ("".join(g), "-".join(g)):
            for tld in ("ch", "com"):
                u = f"https://www.{b}.{tld}"
                if u not in out:
                    out.append(u)
    return out


def _domain(url):
    host = urlparse(url).netloc.lower().removeprefix("www.")
    return ".".join(host.split(".")[-2:])


def _has_word(word, text):
    """Whole-word match (no backslash escapes: lookarounds on letters/digits)."""
    return re.search("(?<![a-z0-9])" + re.escape(word) + "(?![a-z0-9])", text) is not None


def find_site(name, zip_code=None, town=None, url=None):
    """Precision over recall: a wrong website would put another company's activity in the report."""
    if url:
        try:
            r = _client.get(url)
            if r.status_code == 200:
                return str(r.url), r.text, ["url given by the client"]
        except httpx.HTTPError:
            pass
        return None, None, []
    _, distinct = _tokens(name)
    town_word = _ascii((town or "").lower().split(" ")[0].split("/")[0])
    for u in _candidates(name):
        try:
            r = _client.get(u)
        except httpx.HTTPError:
            continue
        if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
            continue
        if _domain(str(r.url)) != _domain(u):  # brunner.ch → brunner.de = another company
            continue
        low = _ascii(r.text.lower())
        hits = [w for w in distinct if _has_word(w, low)]
        zip_hit = bool(zip_code and _has_word(zip_code, low))
        town_hit = bool(len(town_word) > 2 and _has_word(town_word, low))
        domain_words = [w for w in distinct if w in _domain(u)]
        # Identity proof: name word on the page + postcode; or + town when the domain itself carries the name.
        if hits and (zip_hit or (town_hit and domain_words)):
            return str(r.url), r.text, hits + (["zip"] if zip_hit else []) + (["town"] if town_hit else [])
    return None, None, []


def scrape(name, zip_code=None, town=None, url=None, max_pages=4, max_chars=6000, max_images=3):
    site, home, proof = find_site(name, zip_code, town, url)
    if not site:
        return {"status": "empty", "note": "no website found (give the URL to improve)", "tried": _candidates(name)[:6]}
    host = urlparse(site).netloc
    links = []
    for href, label in re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', home, re.S | re.I):
        u = urljoin(site, href)
        if urlparse(u).netloc == host and (PAGE_KW.search(u) or PAGE_KW.search(_text(label))) and u not in links:
            links.append(u)
    pages = [(site, home)]
    for u in links[:max_pages]:
        try:
            r = _client.get(u)
            if r.status_code == 200 and "html" in r.headers.get("content-type", ""):
                pages.append((u, r.text))
        except httpx.HTTPError:
            pass

    text, risk_sentences, images = "", [], []
    for u, h in pages:
        t = _text(h)
        text += f"\n[{u}] {t[:1500]}"
        for s in re.split(r"(?<=[.!?])\s+", t):
            if RISK_KW.search(s) and 20 < len(s) < 300 and s not in risk_sentences:
                risk_sentences.append(s)
        for tag in re.findall(r"<img[^>]+>", h, re.I):
            src = re.search(r'(?:data-src|src)="([^"]+)"', tag)
            if not src:
                continue
            img = urljoin(u, src.group(1))
            alt = (re.search(r'alt="([^"]*)"', tag) or [None, ""])[1]
            w = re.search(r'width="(\d+)"', tag)
            if BAD_IMG.search(img + " " + alt) or (w and int(w.group(1)) < 300) or img in (i["url"] for i in images):
                continue
            images.append({"url": img, "alt": alt[:120], "page": u, "score": int(bool(RISK_KW.search(img + alt))) + int(bool(PAGE_KW.search(u)))})

    images.sort(key=lambda i: -i["score"])
    photos = []
    for im in images[:10]:
        if len(photos) >= max_images:
            break
        data = _download_photo(im["url"])
        if data:
            photos.append({**{k: im[k] for k in ("url", "alt", "page")}, "jpeg": data})
    return {
        "status": "ok",
        "site": site,
        "site_match_proof": proof,
        "pages": [u for u, _ in pages],
        "text_excerpt": text[:max_chars],
        "risk_sentences": risk_sentences[:15],
        "photos": photos,  # [{"url","alt","page","jpeg": bytes}] — bytes are stripped before JSON export
        "js_rendered_suspect": len(text) < 800,
    }


def _download_photo(url, px=768, min_px=300):
    """Download, drop small images (logos/icons), downscale to ≤ 768 px JPEG (fewer vision tokens)."""
    try:
        from PIL import Image
        r = _client.get(url)
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            return None
        im = Image.open(io.BytesIO(r.content)).convert("RGB")
        if min(im.size) < min_px:
            return None
        im.thumbnail((px, px))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=82)
        return buf.getvalue()
    except Exception:  # noqa: BLE001 — a broken image must never break the pipeline
        return None
