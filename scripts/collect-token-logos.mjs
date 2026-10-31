#!/usr/bin/env node
// Collect self-hosted coin logos for every eligible Bitget USDT-M perpetual.
//
//   node scripts/collect-token-logos.mjs [--dry-run] [--refresh]
//
// Mapping: CoinGecko's own Bitget Futures ticker list (symbol -> CoinGecko id),
// cross-checked against Bitget's v3 instrument fullName and the CoinGecko
// symbol. Anything ambiguous or unverified is left out (the site falls back to
// a text badge) -- a wrong project's logo is worse than no logo.
// Images: CoinGecko "large" artwork -> 64x64 WebP (aspect-fit, transparent)
// via Python Pillow (py -3 -m pip install --user pillow).
// Raw responses are cached outside the repo (OX_LOGO_CACHE or
// %TEMP%/ox-token-logos-cache): API JSON for 12h, images by URL forever.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGO_DIR = path.join(ROOT, "src", "assets", "token-logos");
const MANIFEST = path.join(ROOT, "src", "app", "token-logos.js");
const README = path.join(LOGO_DIR, "README.txt");
const CACHE = process.env.OX_LOGO_CACHE || path.join(os.tmpdir(), "ox-token-logos-cache");
const REL = "src/assets/token-logos/";
const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry-run");
const REFRESH = ARGS.has("--refresh");
const JSON_TTL_MS = 12 * 3600 * 1000;
const SIZE = 64;

// Same crypto exceptions as src/markets/crypto/api.js (RWA-flagged but tokens).
const CRYPTO_TOKEN_EXCEPTIONS = new Set(["PAXG", "XAUT", "DGX"]);
// Multiplier prefixes Bitget uses for low-priced coins (1000PEPE, 1MBABYDOGE...).
const MULTIPLIER_RE = /^(1000000|100000|10000|1000|100|10|1M)(?=[A-Z])/;
// Per-host minimum spacing between requests (ms).
const HOST_INTERVAL = { "api.bitget.com": 400, "api.coingecko.com": 2600, default: 400 };

fs.mkdirSync(path.join(CACHE, "json"), { recursive: true });
fs.mkdirSync(path.join(CACHE, "img"), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const lastHit = new Map();

async function throttledFetch(url) {
  const host = new URL(url).host;
  const gap = HOST_INTERVAL[host] ?? HOST_INTERVAL.default;
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = (lastHit.get(host) || 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    let res;
    try {
      res = await fetch(url, { headers: { "user-agent": "ox-crypto-logo-collector/1.0", accept: "*/*" }, signal: AbortSignal.timeout(30000) });
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 5000 * 2 ** attempt);
      console.warn(`  ${res.status} from ${host}; retrying in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`Gave up after retries: ${url}`);
}

async function getJson(url) {
  const file = path.join(CACHE, "json", sha1(url) + ".json");
  if (!REFRESH && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < JSON_TTL_MS) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const buf = await throttledFetch(url);
  const json = JSON.parse(buf.toString("utf8"));
  fs.writeFileSync(file, buf);
  return json;
}

async function getImage(url) {
  const file = path.join(CACHE, "img", sha1(url) + ".bin");
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const buf = await throttledFetch(url);
  fs.writeFileSync(file, buf);
  return file;
}

const STOP_WORDS = new Set(["token", "coin", "protocol", "network", "finance", "the", "inu", "ai", "lab", "labs",
  "dao", "chain", "on", "of", "ex", "vs", "us", "fi", "new", "classic"]);
const squash = (s) => String(s || "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9㐀-鿿]/g, "");
const nameWords = (s) => String(s || "").toLowerCase().normalize("NFKC")
  .split(/[^a-z0-9㐀-鿿]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
const hasCjk = (s) => /[㐀-鿿]/.test(s);

// Loose-but-safe name comparison: exact, long containment ("Naoris" /
// "Naoris Protocol"), CJK containment ("龙虾" / "龙虾 (Lobster)"), or a shared
// distinctive word ("Gold vs US Dollar" / "PAX Gold"). "pump.fun" vs
// "PumpBTC" or "Lighter" vs "Litentry" do NOT agree.
function namesAgree(a, b) {
  const x = squash(a), y = squash(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  if ((shorter.length >= 5 || hasCjk(shorter)) && (x.includes(y) || y.includes(x))) return true;
  const wa = new Set(nameWords(a));
  return nameWords(b).some((w) => wa.has(w));
}

function stripMultiplier(base) {
  const m = base.match(MULTIPLIER_RE);
  return m ? base.slice(m[1].length) : base;
}

function readOldManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  const src = fs.readFileSync(MANIFEST, "utf8");
  const m = src.match(/OX_COIN_LOGOS\s*=\s*(\{[\s\S]*?\})\s*;/);
  return m ? JSON.parse(m[1]) : {};
}

// ---- Python/Pillow converter ------------------------------------------------
const PY_CONVERT = String.raw`
import sys, json, io
from PIL import Image
jobs = json.load(open(sys.argv[1], encoding="utf-8"))
S = int(sys.argv[2])
out = []
for j in jobs:
    r = {"key": j["key"]}
    try:
        im = Image.open(j["src"])
        im.seek(0)
        im = im.convert("RGBA")
        if im.getchannel("A").getextrema()[1] == 0:
            raise ValueError("fully transparent image")
        w0, h0 = im.size
        core = im.crop((w0 * 0.2, h0 * 0.2, w0 * 0.8, h0 * 0.8))
        if core.getchannel("A").getextrema()[0] > 0 and all(hi - lo < 16 for lo, hi in core.convert("RGB").getextrema()):
            raise ValueError("flat placeholder artwork (uniform centre)")
        w, h = im.size
        scale = S / max(w, h)
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        im = im.resize((nw, nh), Image.LANCZOS, reducing_gap=3.0)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        canvas.paste(im, ((S - nw) // 2, (S - nh) // 2))
        data = None
        for q in (85, 78, 70, 60):
            buf = io.BytesIO()
            canvas.save(buf, "WEBP", quality=q, method=6, alpha_quality=90)
            data = buf.getvalue()
            if len(data) <= 4096:
                break
        open(j["dst"], "wb").write(data)
        r.update(ok=True, bytes=len(data), src_size=[w, h])
    except Exception as e:
        r.update(ok=False, error=str(e))
    out.append(r)
json.dump(out, sys.stdout)
`;

function convertAll(jobs) {
  if (!jobs.length) return [];
  const scriptFile = path.join(CACHE, "convert.py");
  const jobFile = path.join(CACHE, "jobs.json");
  fs.writeFileSync(scriptFile, PY_CONVERT);
  fs.writeFileSync(jobFile, JSON.stringify(jobs));
  for (const py of [["py", ["-3", "-E", "-P"]], ["python", ["-E", "-P"]], ["python3", ["-E", "-P"]]]) {
    const r = spawnSync(py[0], [...py[1], scriptFile, jobFile, String(SIZE)], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`Image conversion failed (${py[0]}): ${r.stderr}`);
    return JSON.parse(r.stdout);
  }
  throw new Error("Python 3 with Pillow is required (py -3 -m pip install --user pillow)");
}

// ---- main ---------------------------------------------------------------------
export async function collectTokenLogos() {
  console.log(`cache: ${CACHE}`);

  // 1. Bitget symbols (2 requests).
  const v2 = await getJson("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES");
  if (v2.code !== "00000" || !Array.isArray(v2.data)) throw new Error("Bitget contracts request failed");
  let v3 = [];
  try {
    const j = await getJson("https://api.bitget.com/api/v3/market/instruments?category=USDT-FUTURES");
    v3 = Array.isArray(j.data) ? j.data : [];
  } catch (err) {
    console.warn(`Bitget v3 instruments unavailable (${err.message}); falling back to isRwa flag only`);
  }
  const v3BySymbol = new Map(v3.map((x) => [x.symbol, x]));
  const live = v2.data.filter((c) => ["normal", "listed"].includes(c.symbolStatus) &&
    c.symbolType === "perpetual" && c.quoteCoin === "USDT" && c.symbol.endsWith("USDT"));
  const eligible = [];
  for (const c of live) {
    const base = c.symbol.slice(0, -4);
    const meta = v3BySymbol.get(c.symbol);
    const isCrypto = CRYPTO_TOKEN_EXCEPTIONS.has(base) ||
      (meta ? meta.symbolType === "crypto" && String(meta.isRwa).toUpperCase() !== "YES"
            : String(c.isRwa).toUpperCase() === "NO");
    if (isCrypto) eligible.push({ symbol: c.symbol, base, key: base.toLowerCase(), fullName: meta?.fullName || "" });
  }
  console.log(`Bitget USDT-M perpetuals: ${live.length} live, ${eligible.length} crypto-eligible bases`);

  // 2. Bitget symbol -> CoinGecko id (CoinGecko's own Bitget Futures mapping).
  const der = await getJson("https://api.coingecko.com/api/v3/derivatives/exchanges/bitget_futures?include_tickers=unexpired");
  const cgIdsBySymbol = new Map();
  for (const t of der.tickers || []) {
    const sym = String(t.symbol || "").replace(/_UMCBL$/, "");
    if (!t.coin_id || t.target !== "USDT") continue;
    if (!cgIdsBySymbol.has(sym)) cgIdsBySymbol.set(sym, new Set());
    cgIdsBySymbol.get(sym).add(t.coin_id);
  }

  const results = new Map(); // key -> {status, reason, id, ...}
  for (const e of eligible) {
    const ids = [...(cgIdsBySymbol.get(e.symbol) || [])];
    if (ids.length === 1) e.cgId = ids[0];
    else if (ids.length > 1) results.set(e.key, { ...e, status: "none", reason: `ambiguous: CoinGecko lists ${ids.join(", ")}` });
  }

  // 2b. Unmapped: CoinGecko search, accepted only on exact symbol + name match.
  for (const e of eligible) {
    if (e.cgId || results.has(e.key)) continue;
    const want = stripMultiplier(e.base).toLowerCase();
    if (!e.fullName) { results.set(e.key, { ...e, status: "none", reason: "unmatched: not in CoinGecko Bitget list, no Bitget name to verify" }); continue; }
    const s = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(e.fullName)}`);
    const cands = (s.coins || []).filter((c) => String(c.symbol).toLowerCase() === want && namesAgree(c.name, e.fullName));
    if (cands.length === 1) e.cgId = cands[0].id;
    else results.set(e.key, { ...e, status: "none", reason: cands.length ? `ambiguous: ${cands.map((c) => c.id).join(", ")}` : `unmatched: no CoinGecko coin "${e.fullName}" with symbol ${want.toUpperCase()}` });
  }

  // 3. CoinGecko market data (names, symbols, image URLs) in chunks.
  const ids = [...new Set(eligible.map((e) => e.cgId).filter(Boolean))].sort();
  const cg = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1&ids=${chunk.join(",")}`);
    for (const r of rows) cg.set(r.id, r);
  }

  // 4. Verify each mapping before using its image. A symbol match alone is not
  // enough when both sides carry a real project name that disagrees (e.g.
  // CoinGecko maps Bitget PUMP "pump.fun" to PumpBTC): then search CoinGecko by
  // the Bitget name and either correct the id or leave the coin out.
  const symbolMatches = (e, sym) => [e.base, stripMultiplier(e.base)].some((s) => s.toLowerCase() === String(sym).toLowerCase());
  const corrections = [];
  for (const e of eligible) {
    if (results.has(e.key)) continue;
    const c = cg.get(e.cgId);
    if (!c) { results.set(e.key, { ...e, status: "none", reason: `unmatched: CoinGecko id ${e.cgId} returned no market data` }); continue; }
    const symOk = symbolMatches(e, c.symbol);
    // Names that merely repeat the ticker carry no information.
    const bitgetNameInfo = e.fullName && squash(e.fullName) !== squash(e.base) && squash(e.fullName) !== squash(stripMultiplier(e.base));
    const cgNameInfo = squash(c.name) !== squash(c.symbol);
    const nameOk = namesAgree(c.name, e.fullName) || namesAgree(e.cgId.replace(/-\d+$/, ""), e.fullName);
    e.cgName = c.name; e.cgSymbol = c.symbol;
    if (nameOk) {
      if (!symOk) e.note = `symbol differs (rebrand/ticker change): Bitget ${e.base} vs CoinGecko ${c.symbol} "${c.name}"`;
      continue;
    }
    if (!(bitgetNameInfo && cgNameInfo)) {
      if (symOk) { e.note = `accepted on CoinGecko Bitget mapping + symbol (no comparable name): Bitget "${e.fullName}" vs CoinGecko "${c.name}"`; continue; }
      results.set(e.key, { ...e, status: "none", reason: `ambiguous: Bitget "${e.base} / ${e.fullName}" vs CoinGecko "${c.symbol} / ${c.name}" (${e.cgId})` });
      continue;
    }
    // Real names disagree: ask CoinGecko search.
    const s = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(e.fullName)}`);
    const sameSym = (s.coins || []).filter((x) => symbolMatches(e, x.symbol));
    const agreeing = sameSym.filter((x) => namesAgree(x.name, e.fullName) || namesAgree(x.id.replace(/-\d+$/, ""), e.fullName));
    if (agreeing.length === 1) {
      corrections.push(`${e.base}: ${e.cgId} ("${c.name}") -> ${agreeing[0].id} ("${agreeing[0].name}")`);
      e.note = `corrected CoinGecko mapping ${e.cgId} -> ${agreeing[0].id}`;
      e.cgId = agreeing[0].id;
    } else if (agreeing.length === 0 && sameSym.some((x) => x.id === e.cgId)) {
      e.note = `name differs but CoinGecko search for "${e.fullName}" returns ${e.cgId} ("${c.name}")`;
    } else {
      results.set(e.key, { ...e, status: "none", reason: `ambiguous: Bitget "${e.base} / ${e.fullName}" vs CoinGecko "${c.symbol} / ${c.name}" (${e.cgId})${agreeing.length > 1 ? `; search candidates ${agreeing.map((x) => x.id).join(", ")}` : ""}` });
    }
  }
  const extraIds = [...new Set(eligible.filter((e) => !results.has(e.key) && e.cgId && !cg.has(e.cgId)).map((e) => e.cgId))];
  if (extraIds.length) {
    const rows = await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1&ids=${extraIds.sort().join(",")}`);
    for (const r of rows) cg.set(r.id, r);
  }
  const toFetch = [];
  for (const e of eligible) {
    if (results.has(e.key)) continue;
    const c = cg.get(e.cgId);
    if (!c) { results.set(e.key, { ...e, status: "none", reason: `unmatched: CoinGecko id ${e.cgId} returned no market data` }); continue; }
    e.cgName = c.name; e.cgSymbol = c.symbol;
    const img = c.image || "";
    if (!img || /missing_|\/missing|placeholder/i.test(img)) {
      results.set(e.key, { ...e, status: "none", reason: "placeholder: CoinGecko has no artwork" });
      continue;
    }
    e.imageUrl = img.replace("/small/", "/large/").replace("/thumb/", "/large/");
    toFetch.push(e);
  }

  // 5. Download (throttled, cached) and drop shared placeholder images.
  let n = 0;
  for (const e of toFetch) {
    try {
      e.srcFile = await getImage(e.imageUrl);
      e.hash = sha1(fs.readFileSync(e.srcFile));
    } catch (err) {
      results.set(e.key, { ...e, status: "none", reason: `download failed: ${err.message}` });
    }
    if (++n % 50 === 0) console.log(`  images ${n}/${toFetch.length}`);
  }
  const idsByHash = new Map();
  for (const e of toFetch) if (e.hash) {
    if (!idsByHash.has(e.hash)) idsByHash.set(e.hash, new Set());
    idsByHash.get(e.hash).add(e.cgId);
  }
  const ready = toFetch.filter((e) => {
    if (!e.hash) return false;
    if (idsByHash.get(e.hash).size > 1) {
      results.set(e.key, { ...e, status: "none", reason: `placeholder: identical image shared by ${[...idsByHash.get(e.hash)].join(", ")}` });
      return false;
    }
    return true;
  });

  // 6. Convert to 64x64 WebP.
  const outDir = DRY ? path.join(CACHE, "out") : LOGO_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const conv = convertAll(ready.map((e) => ({ key: e.key, src: e.srcFile, dst: path.join(outDir, e.key + ".webp") })));
  const convByKey = new Map(conv.map((r) => [r.key, r]));
  for (const e of ready) {
    const r = convByKey.get(e.key);
    if (r?.ok) results.set(e.key, { ...e, status: "logo", source: "coingecko", file: e.key + ".webp", bytes: r.bytes, srcSize: r.src_size });
    else results.set(e.key, { ...e, status: "none", reason: `placeholder/invalid image: ${r?.error || "conversion failed"}` });
  }

  // 7. Manifest: new WebP logos, legacy PNGs kept where nothing better exists.
  const old = readOldManifest();
  const manifest = {};
  for (const [key, r] of results) if (r.status === "logo") manifest[key] = REL + r.file;
  for (const [key, p] of Object.entries(old)) {
    if (manifest[key]) continue;
    const file = path.join(ROOT, p);
    if (fs.existsSync(file)) {
      manifest[key] = p;
      const r = results.get(key);
      if (r) results.set(key, { ...r, status: "logo", source: "legacy", file: path.basename(p), legacyBecause: r.reason });
    }
  }
  // Alias keys for multiplier tickers (1000PEPE -> pepe) when the key is free.
  const eligibleKeys = new Set(eligible.map((e) => e.key));
  const aliases = [];
  for (const e of eligible) {
    const stripped = stripMultiplier(e.base).toLowerCase();
    if (stripped === e.key || !manifest[e.key]) continue;
    if (eligibleKeys.has(stripped)) continue; // a different Bitget contract owns it
    if (manifest[stripped] && !(old[stripped] && manifest[stripped] === old[stripped])) continue;
    manifest[stripped] = manifest[e.key];
    aliases.push(`${stripped} -> ${e.key}`);
  }
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));

  if (!DRY) {
    const header = "/* Local token artwork; source attribution: ../assets/token-logos/README.txt. Generated by scripts/collect-token-logos.mjs. */\n";
    fs.writeFileSync(MANIFEST, header + "const OX_COIN_LOGOS = " + JSON.stringify(sorted).replace(/","/g, '", "').replace(/":"/g, '": "') + ";\n");
    const referenced = new Set(Object.values(sorted).map((p) => path.basename(p)));
    for (const f of fs.readdirSync(LOGO_DIR)) {
      if (/\.(png|webp|jpe?g|svg)$/i.test(f) && !referenced.has(f)) fs.unlinkSync(path.join(LOGO_DIR, f));
    }
    const legacyUsed = Object.values(sorted).some((p) => p.endsWith(".png"));
    fs.writeFileSync(README, [
      "Token artwork",
      "",
      "Generated by scripts/collect-token-logos.mjs.",
      "",
      "Sources:",
      "- CoinGecko (https://www.coingecko.com) coin artwork. Bitget USDT-M perpetual symbols are mapped",
      "  to CoinGecko ids via CoinGecko's Bitget Futures ticker list and cross-checked against Bitget's",
      "  instrument names; images are resized to 64x64 WebP.",
      ...(legacyUsed ? [
        "- Legacy 32px PNGs kept only where no verified CoinGecko artwork exists:",
        "  https://github.com/spothq/cryptocurrency-icons (LICENSE-spothq.txt)",
        "  https://github.com/ErikThiart/cryptocurrency-icons (LICENSE-ErikThiart.txt)",
      ] : []),
      "",
      "Logos and trademarks belong to their respective token projects; they are used only to identify",
      "the listed market symbols. No price data is imported from these sources.",
      "Ambiguous or unmatched symbols get no image and are shown with text initials instead of a",
      "possibly unrelated logo.",
      "",
    ].join("\n"));
  }

  // 8. Report.
  const all = eligible.map((e) => results.get(e.key));
  const withLogo = all.filter((r) => r.status === "logo");
  const bySource = {};
  for (const r of withLogo) bySource[r.source] = (bySource[r.source] || 0) + 1;
  const missing = all.filter((r) => r.status !== "logo").map((r) => ({ base: r.base, name: r.fullName, reason: r.reason }));
  const notes = all.filter((r) => r.note && r.status === "logo").map((r) => `${r.base}: ${r.note} (${r.cgId})`);
  const report = {
    generatedAt: new Date().toISOString(),
    eligibleBases: eligible.length,
    withLogo: withLogo.length,
    bySource,
    manifestKeys: Object.keys(sorted).length,
    aliases,
    corrections,
    withoutLogo: missing,
    reviewNotes: notes,
    totalBytes: withLogo.reduce((s, r) => s + (r.bytes || 0), 0),
    mapping: Object.fromEntries(withLogo.map((r) => [r.key, r.cgId || null])),
  };
  fs.writeFileSync(path.join(CACHE, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nEligible perpetual bases: ${report.eligibleBases}`);
  console.log(`With logo: ${report.withLogo} (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  console.log(`Manifest keys: ${report.manifestKeys} (aliases: ${aliases.join(", ") || "none"})`);
  if (corrections.length) console.log(`Corrected CoinGecko mappings:\n  ${corrections.join("\n  ")}`);
  if (notes.length) console.log(`Review notes (accepted, names/symbols differ):\n  ${notes.join("\n  ")}`);
  console.log(`Without logo (${missing.length}):`);
  for (const m of missing) console.log(`  ${m.base}${m.name ? ` (${m.name})` : ""}: ${m.reason}`);
  console.log(`Full report: ${path.join(CACHE, "report.json")}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectTokenLogos().catch((err) => { console.error(err); process.exit(1); });
}
