var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// lib/lean.js
var require_lean = __commonJS({
  "lib/lean.js"() {
    if (process.env.LEAN === "1") {
      const d = {
        MAX_STORIES: "8",
        MAX_RELEASES: "4",
        RELEASES_PER_SOURCE: "2",
        MAX_LLM_CALLS_PER_DAY: "60",
        RESYNTH_MIN_GROWTH: "2",
        ANALYSIS_MAX_PER_RUN: "6",
        ANTHROPIC_MODEL: "claude-haiku-5-5",
        ANALYSIS_MODEL: "claude-sonnet-5-5"
      };
      for (const [k, v] of Object.entries(d)) if (!process.env[k]) process.env[k] = v;
    }
  }
});

// lib/files.js
var require_files = __commonJS({
  "lib/files.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var ROOT = process.env.RECON_ROOT || process.cwd();
    var roots = [ROOT, path.join(__dirname, "..")];
    function find(name) {
      for (const r of roots) for (const sub of ["config", "public", ""]) {
        const p = path.join(r, sub, name);
        if (fs.existsSync(p)) return p;
      }
      throw new Error(`file not found: ${name} (looked in config/, public/ and the repository root)`);
    }
    module2.exports = { find, ROOT };
  }
});

// lib/paths.js
var require_paths = __commonJS({
  "lib/paths.js"(exports2, module2) {
    require_lean();
    var fs = require("fs");
    var path = require("path");
    var DATA = process.env.DATA_DIR || path.join(process.cwd(), "data");
    fs.mkdirSync(DATA, { recursive: true });
    var SEED_RATES = require_files().find("rates.json");
    var RATES = process.env.DATA_DIR ? path.join(DATA, "rates.json") : SEED_RATES;
    if (process.env.DATA_DIR && !fs.existsSync(RATES)) fs.copyFileSync(SEED_RATES, RATES);
    module2.exports = { DATA, RATES, DB: process.env.DB_PATH || path.join(DATA, "margin.db") };
  }
});

// lib/db.js
var require_db = __commonJS({
  "lib/db.js"(exports2, module2) {
    var Database = require("better-sqlite3");
    var path = require("path");
    var db2 = new Database(require_paths().DB);
    db2.pragma("journal_mode = WAL");
    db2.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT,
  published_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  cluster_key TEXT UNIQUE NOT NULL,
  topic TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_points TEXT NOT NULL,      -- JSON array
  why_it_matters TEXT NOT NULL,
  disagreements TEXT,            -- JSON array
  confidence TEXT NOT NULL,      -- HIGH | MEDIUM | LOW
  sources TEXT NOT NULL,         -- JSON array [{name,url,title}]
  source_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS llm_usage (day TEXT PRIMARY KEY, calls INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, question TEXT NOT NULL, story_id INTEGER, source TEXT, created_at TEXT DEFAULT (datetime('now')));   -- id = London date
CREATE TABLE IF NOT EXISTS poll_votes (poll_id TEXT NOT NULL, voter TEXT NOT NULL, choice TEXT NOT NULL, at TEXT DEFAULT (datetime('now')), PRIMARY KEY (poll_id, voter));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS release_seen (url TEXT PRIMARY KEY, outcome TEXT, at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS source_health (
  url TEXT PRIMARY KEY, name TEXT, tier TEXT, required INTEGER DEFAULT 0,
  last_ok TEXT, last_error TEXT, items INTEGER DEFAULT 0, note TEXT, checked_at TEXT
);
CREATE TABLE IF NOT EXISTS rate_snapshots (
  id INTEGER PRIMARY KEY,
  bank TEXT NOT NULL,            -- BOE | FED | ECB
  rate REAL NOT NULL,            -- policy rate (Fed: upper bound of range)
  prob_dir TEXT, prob_pct REAL, prob_bp REAL,   -- market pricing for the next meeting
  next_at TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL,
  bank TEXT NOT NULL, event_id TEXT NOT NULL, event_at TEXT NOT NULL,
  expect TEXT NOT NULL,          -- HIKE | HOLD | CUT
  conviction TEXT,
  baseline_rate REAL NOT NULL,   -- policy rate when the call was made
  mkt_expect TEXT, mkt_pct REAL, -- what the market favourite was when the call was made
  made_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT, actual TEXT, final_rate REAL, correct INTEGER, status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | RESOLVED | VOID
  UNIQUE (bank, event_id, story_id)
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',   -- JSON array, empty = all
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  last_sent_at TEXT
);
`);
    var addCol = (t, c, d) => {
      if (!db2.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)) db2.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
    };
    addCol("articles", "full_text", "TEXT");
    addCol("articles", "tier", "TEXT DEFAULT 'snippet'");
    addCol("stories", "assessment", "TEXT");
    addCol("stories", "analysis", "TEXT");
    addCol("stories", "read_mins", "INTEGER");
    addCol("stories", "kind", "TEXT DEFAULT 'REPORT'");
    module2.exports = db2;
  }
});

// lib/sources.js
var require_sources = __commonJS({
  "lib/sources.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var cfg = JSON.parse(fs.readFileSync(require_files().find("publishers.json"), "utf8"));
    var SOURCES = cfg.publishers;
    module2.exports = SOURCES;
    module2.exports.MIN_FULL = +(process.env.MIN_FULL_SOURCES || cfg.minFullSources || 1);
    module2.exports.FINANCE_RE = /\b(econom\w*|inflation|interest rates?|central bank|fed|federal reserve|bank of england|ecb|gdp|recession|tariffs?|trade|markets?|stocks?|shares|bonds?|gilts?|yields?|oil|currency|sterling|dollar|euro|mortgages?|housing|jobs|unemployment|wages?|budget|tax|debt|banks?|banking|earnings|ipo|merger|crypto|bitcoin|ftse|lender|insurer|results|profits?|spending|borrowing|fiscal|monetary|growth|stamp duty|pension|savings)\b/i;
    module2.exports.UK_RE = /\b(uk|u\.k\.|britain|british|england|london|scotland|wales|sterling|gilts?|ftse|bank of england|boe|bailey|mpc|labour|chancellor|reeves|ons|hmrc|fca|pra|barclays|lloyds|hsbc|natwest|nationwide|santander uk|standard chartered|london stock exchange|city of london|autumn budget|stamp duty|isa)\b/i;
    module2.exports.DRIVERS_RE = /\b(federal reserve|fed|fomc|ecb|tariffs?|brent|opec|treasury yields|wall street|s&p 500|nasdaq|strait of hormuz)\b/i;
    module2.exports.TOPICS = ["RATES & BOE", "UK ECONOMY", "BANKING", "MARKETS", "PROPERTY", "FISCAL", "ENERGY & TRADE"];
  }
});

// lib/ingest.js
var require_ingest = __commonJS({
  "lib/ingest.js"(exports2, module2) {
    var Parser = require("rss-parser");
    var db2 = require_db();
    var SOURCES = require_sources();
    var parser = new Parser({ timeout: 15e3, headers: { "User-Agent": "ReconBot/1.0 (+news aggregation; links back to sources)" } });
    var strip = (s) => (s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    var HOSTS = { "Financial Times": "ft.com", Bloomberg: "bloomberg.com", "BBC News": "bbc.co.uk", "The Guardian": "theguardian.com", "Sky News": "news.sky.com", "The Telegraph": "telegraph.co.uk", "The Independent": "independent.co.uk", "This is Money": "thisismoney.co.uk", "The Economist": "economist.com", CNBC: "cnbc.com", MarketWatch: "marketwatch.com", WSJ: "wsj.com", "City AM": "cityam.com", IFS: "ifs.org.uk", Reuters: "reuters.com" };
    async function discover(site) {
      try {
        const r = await fetch(site, { headers: { "User-Agent": "ReconBot/1.0" }, redirect: "follow" });
        const html = await r.text();
        const m = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(html);
        const href = m && /href=["']([^"']+)["']/i.exec(m[0]);
        return href ? new URL(href[1], site).toString() : null;
      } catch {
        return null;
      }
    }
    function itemsFrom(src, feed) {
      const out = [], now = Date.now();
      for (const it of feed.items || []) {
        let title = strip(it.title);
        if (src.suffix) title = title.replace(new RegExp(`\\s+[-\u2013|]\\s+${src.suffix}\\s*$`, "i"), "");
        const snippet = src.viaGoogleNews ? "" : strip(it.contentSnippet || it.summary || (src.tier === "full" ? it.content : "") || "").slice(0, src.tier === "full" ? 1500 : 400);
        if (!title || !it.link) continue;
        const text = title + " " + snippet;
        if (src.filter && !SOURCES.FINANCE_RE.test(text)) continue;
        if (src.global && !(SOURCES.UK_RE.test(text) || SOURCES.DRIVERS_RE.test(text))) continue;
        const when = new Date(it.isoDate || it.pubDate || now);
        if (!isNaN(when) && when.getTime() > now + 2 * 36e5) continue;
        out.push({ url: it.link, title, snippet, at: (isNaN(when) ? /* @__PURE__ */ new Date() : when).toISOString() });
      }
      return out;
    }
    async function ingest({ parseURL = (u) => parser.parseURL(u), discoverFn = discover } = {}) {
      const insert = db2.prepare(`INSERT OR IGNORE INTO articles (url, source, title, snippet, published_at, tier) VALUES (?,?,?,?,?,?)`);
      const health = db2.prepare(`INSERT INTO source_health (url,name,tier,required,last_ok,last_error,items,note,checked_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(url) DO UPDATE SET name=excluded.name,tier=excluded.tier,required=excluded.required,last_ok=COALESCE(excluded.last_ok,last_ok),last_error=excluded.last_error,items=excluded.items,note=COALESCE(excluded.note,note),checked_at=excluded.checked_at`);
      let added = 0;
      const failed = [], stats = [];
      await Promise.all(SOURCES.filter((s) => s.enabled !== false).map(async (src) => {
        let note = null;
        try {
          let feed;
          try {
            feed = await parseURL(src.url);
          } catch (e) {
            const alt = src.site ? await discoverFn(src.site) : null;
            try {
              if (!alt || alt === src.url) throw e;
              feed = await parseURL(alt);
              note = `feed URL failed; autodiscovered ${alt} (update publishers.json)`;
            } catch (e2) {
              if (src.tier === "full" || src.viaGoogleNews) throw e;
              const host = HOSTS[src.name] || new URL(src.site || src.url).hostname.replace(/^www\./, "");
              feed = await parseURL(`https://news.google.com/rss/search?q=site:${host}+when:2d&hl=en-GB&gl=GB&ceid=GB:en`);
              src = { ...src, viaGoogleNews: true, suffix: src.suffix || src.name.replace(/^The /, "(?:The )?"), filter: true };
              note = `direct feed blocked (${String(e.message).slice(0, 60)}); using Google News headlines`;
            }
          }
          const items = itemsFrom(src, feed);
          for (const a of items) added += insert.run(a.url, src.name, a.title, a.snippet, a.at, src.tier === "full" ? "full" : "snippet").changes;
          health.run(src.url, src.name, src.tier, src.required ? 1 : 0, (/* @__PURE__ */ new Date()).toISOString(), null, items.length, note);
          stats.push({ name: src.name, url: src.url, ok: true, items: items.length, note });
        } catch (e) {
          failed.push(`${src.name}: ${e.message}`);
          stats.push({ name: src.name, url: src.url, ok: false, items: 0, error: String(e.message).slice(0, 120) });
          health.run(src.url, src.name, src.tier, src.required ? 1 : 0, null, String(e.message).slice(0, 200), 0, note);
        }
      }));
      const quiet = db2.prepare(`SELECT name,url FROM source_health WHERE required=1 AND (last_ok IS NULL OR julianday('now')-julianday(last_ok) > 2)`).all();
      const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
      for (const n of new Set(SOURCES.filter((x) => x.enabled !== false && x.required).map((x) => x.name)))
        if (!db2.prepare("SELECT 1 FROM articles WHERE source=? AND published_at>=?").get(n, since7) && !quiet.some((q) => q.name === n)) quiet.push({ name: n, url: "(no items in 7 days)" });
      console.log(`[ingest] +${added} articles, ${failed.length} feeds failed`);
      failed.forEach((f) => console.log("  ! " + f));
      quiet.forEach((q) => console.log(`  !! REQUIRED source silent for 48h+: ${q.name} (${q.url})`));
      return { added, failed, quiet, stats };
    }
    module2.exports = ingest;
    module2.exports.itemsFrom = itemsFrom;
    if (require.main === module2) {
      require("dotenv").config();
      ingest().then(() => process.exit(0));
    }
  }
});

// lib/cluster.js
var require_cluster = __commonJS({
  "lib/cluster.js"(exports2, module2) {
    var crypto = require("crypto");
    var MIN_SOURCES = +(process.env.MIN_SOURCES || 3);
    var THRESHOLD = +(process.env.SIM_THRESHOLD || 0.28);
    var STOP = new Set("the a an and or of to in on for with at by from as is are was were be been it its this that these those after over amid into than but not has have had will would could says said say new more up down out about us uk".split(" "));
    var tok = (s) => (s.toLowerCase().match(/[a-z0-9£$%.]+/g) || []).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length > 2 && !STOP.has(w));
    function vectorise(arts) {
      const docs = arts.map((a) => tok(a.title + " " + a.title + " " + (a.snippet || "")));
      const df = /* @__PURE__ */ new Map();
      docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
      const N = docs.length;
      return docs.map((d) => {
        const tf = /* @__PURE__ */ new Map();
        d.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
        const v = /* @__PURE__ */ new Map();
        let norm = 0;
        tf.forEach((c, w) => {
          const x = c * Math.log(1 + N / df.get(w));
          v.set(w, x);
          norm += x * x;
        });
        norm = Math.sqrt(norm) || 1;
        v.forEach((x, w) => v.set(w, x / norm));
        return v;
      });
    }
    var cos = (a, b) => {
      let s = 0;
      const [x, y] = a.size < b.size ? [a, b] : [b, a];
      x.forEach((v, w) => {
        if (y.has(w)) s += v * y.get(w);
      });
      return s;
    };
    function cluster(arts, th = THRESHOLD) {
      const vecs = vectorise(arts);
      const parent = arts.map((_, i) => i);
      const find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);
      for (let i = 0; i < arts.length; i++)
        for (let j = i + 1; j < arts.length; j++)
          if (arts[i].source !== arts[j].source && cos(vecs[i], vecs[j]) >= th) parent[find(i)] = find(j);
      const groups = /* @__PURE__ */ new Map();
      arts.forEach((a, i) => {
        const r = find(i);
        (groups.get(r) || groups.set(r, []).get(r)).push(a);
      });
      return [...groups.values()].map((g) => {
        const by = /* @__PURE__ */ new Map();
        g.sort((a, b) => b.published_at.localeCompare(a.published_at)).forEach((a) => {
          if (!by.has(a.source)) by.set(a.source, a);
        });
        return [...by.values()];
      }).filter((g) => g.length >= MIN_SOURCES).map((g) => ({ articles: g, key: crypto.createHash("sha1").update(g.map((a) => a.url).sort()[0]).digest("hex").slice(0, 16) })).sort((a, b) => b.articles.length - a.articles.length);
    }
    function clusterAdaptive(arts, target = +(process.env.MIN_STORIES_TARGET || 4)) {
      let best = { clusters: [], th: THRESHOLD };
      for (const th of [THRESHOLD, 0.23, 0.19]) {
        const c = cluster(arts, th);
        if (c.length > best.clusters.length || th === THRESHOLD) best = { clusters: c, th };
        if (c.length >= target) break;
      }
      return best;
    }
    module2.exports = { cluster, clusterAdaptive, MIN_SOURCES };
  }
});

// lib/fulltext.js
var require_fulltext = __commonJS({
  "lib/fulltext.js"(exports2, module2) {
    var { JSDOM, VirtualConsole } = require("jsdom");
    var { Readability } = require("@mozilla/readability");
    var db2 = require_db();
    var MAX_CHARS = +(process.env.FULLTEXT_MAX_CHARS || 6500);
    async function fetchText(url) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12e3);
      try {
        const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "ReconBot/1.0 (+news aggregation; links back to sources)", "Accept": "text/html" } });
        if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return "";
        let html = (await res.text()).slice(0, 15e5);
        if (/(^|\.)ons\.gov\.uk$/i.test(new URL(url).hostname)) {
          const m = /href=["']([^"']*\/(?:bulletins|articles)\/[^"']+)["']/i.exec(html);
          if (m) {
            try {
              const r2 = await fetch(new URL(m[1], url).toString(), { signal: ctl.signal, headers: { "User-Agent": "ReconBot/1.0 (+news aggregation; links back to sources)", "Accept": "text/html" } });
              if (r2.ok) {
                html = (await r2.text()).slice(0, 15e5);
                url = new URL(m[1], url).toString();
              }
            } catch {
            }
          }
        }
        const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
        const art = new Readability(dom.window.document).parse();
        return (art?.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
      } catch {
        return "";
      } finally {
        clearTimeout(t);
      }
    }
    async function fillFullText(articles, fetcher = fetchText) {
      if (process.env.FULLTEXT === "0" || process.env.DEMO === "1") return;
      const upd = db2.prepare("UPDATE articles SET full_text=? WHERE id=?");
      const todo = articles.filter((a) => a.tier === "full" && a.full_text == null);
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async (a) => {
          a.full_text = await fetcher(a.url);
          upd.run(a.full_text, a.id);
        }));
      }
    }
    module2.exports = { fillFullText };
  }
});

// lib/llm.js
var require_llm = __commonJS({
  "lib/llm.js"(exports2, module2) {
    var db2 = require_db();
    var client;
    var CAP = () => +(process.env.MAX_LLM_CALLS_PER_DAY || 150);
    var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    var lastCall = 0;
    var provider = () => process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.LLM_BASE_URL && process.env.LLM_API_KEY ? "openai" : "none");
    function configured() {
      return !!module2.exports._mock || provider() !== "none";
    }
    var parseJSON = (t) => {
      const a = t.indexOf("{"), b = t.lastIndexOf("}");
      if (a < 0 || b < a) throw new Error("model returned no JSON");
      return JSON.parse(t.slice(a, b + 1));
    };
    var record = (i, o) => db2.prepare(`INSERT INTO llm_usage (day,calls,input_tokens,output_tokens) VALUES (?,1,?,?) ON CONFLICT(day) DO UPDATE SET calls=calls+1,input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens`).run(today(), i || 0, o || 0);
    async function throttle() {
      const gap = +(process.env.LLM_MIN_INTERVAL_MS || 0);
      const wait = lastCall + gap - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
    }
    async function anthropicJSON(system, user, { max, model }) {
      const Anthropic = require("@anthropic-ai/sdk");
      client = client || new Anthropic();
      const r = await client.messages.create({ model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: max, system, messages: [{ role: "user", content: user }] });
      record(r.usage?.input_tokens, r.usage?.output_tokens);
      if (r.stop_reason === "max_tokens") throw new Error("model output truncated");
      return parseJSON(r.content.map((c) => c.text || "").join(""));
    }
    async function openaiJSON(system, user, { max, model }) {
      const base = process.env.LLM_BASE_URL.replace(/\/$/, "");
      for (let attempt = 0; attempt < 4; attempt++) {
        await throttle();
        const res = await fetch(base + "/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model || process.env.LLM_MODEL,
            temperature: 0.2,
            max_tokens: max,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            ...process.env.LLM_JSON_MODE === "1" ? { response_format: { type: "json_object" } } : {}
          })
        });
        if (res.status === 429 || res.status >= 500) {
          await sleep(+(process.env.LLM_RETRY_MS || 15e3) * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = await res.json();
        record(j.usage?.prompt_tokens, j.usage?.completion_tokens);
        if (j.choices?.[0]?.finish_reason === "length") throw new Error("model output truncated");
        return parseJSON(j.choices?.[0]?.message?.content || "");
      }
      throw new Error("LLM: rate limited after retries");
    }
    async function json(system, user, opts = {}) {
      if (module2.exports._mock) return module2.exports._mock(system, user);
      const used = db2.prepare("SELECT calls FROM llm_usage WHERE day=?").get(today());
      if (used && used.calls >= CAP()) throw new Error(`daily AI call cap reached (${CAP()}); raise MAX_LLM_CALLS_PER_DAY if intended`);
      const p = provider();
      if (p === "anthropic") return anthropicJSON(system, user, opts);
      if (p === "openai") return openaiJSON(system, user, opts);
      throw new Error("no AI provider configured (set ANTHROPIC_API_KEY, or LLM_BASE_URL + LLM_API_KEY + LLM_MODEL)");
    }
    module2.exports = { json, configured };
  }
});

// lib/verify.js
var require_verify = __commonJS({
  "lib/verify.js"(exports2, module2) {
    var NUM = /\d[\d,]*(?:\.\d+)?/g;
    var norm = (s) => String(s).replace(/,/g, "");
    var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var strip = (s) => String(s).replace(/\[\d+\]/g, " ");
    function numbers(text) {
      return (strip(text).match(NUM) || []).map(norm);
    }
    function present(tok, corpusNorm) {
      return new RegExp(`(?<![\\d.])${esc(tok)}(?!\\d|\\.\\d)`).test(corpusNorm);
    }
    function allPresent(text, corpus) {
      const c = norm(corpus);
      return numbers(text).every((t) => present(t, c));
    }
    var sentences = (p) => String(p).split(/(?<=[.!?])\s+(?=[A-Z£$€\[(])/);
    function cleanText(paras, corpus, stats) {
      const out = [];
      for (const p of paras || []) {
        const kept = sentences(p).filter((s) => {
          const ok = allPresent(s, corpus);
          if (!ok) stats.droppedSentences++;
          return ok;
        });
        if (kept.length) out.push(kept.join(" "));
      }
      return out;
    }
    function cleanAssessment(a, sourceTexts, extraCorpus = "") {
      const stats = { droppedSentences: 0, droppedRows: 0 };
      if (!a || typeof a !== "object") return { assessment: null, stats };
      const all = sourceTexts.join(" ") + " " + extraCorpus;
      const arr = (x) => Array.isArray(x) ? x.filter((v) => typeof v === "string") : [];
      const out = {
        situation: cleanText(arr(a.situation), all, stats),
        background: cleanText(arr(a.background), all, stats),
        market_reaction: cleanText(arr(a.market_reaction), all, stats),
        compare: cleanText(arr(a.compare), all, stats),
        numbers: [],
        watch: []
      };
      for (const r of Array.isArray(a.numbers) ? a.numbers : []) {
        const src = +r?.source, txt = sourceTexts[src - 1];
        if (!r || !r.label || !r.value || !txt || !/\d/.test(String(r.value)) || !allPresent(String(r.value), txt)) {
          stats.droppedRows++;
          continue;
        }
        out.numbers.push({ label: String(r.label).slice(0, 80), value: String(r.value).slice(0, 40), source: src, context: String(r.context || "").slice(0, 160) });
      }
      for (const w of Array.isArray(a.watch) ? a.watch : []) {
        if (!w || !w.what) continue;
        if (!allPresent(String(w.what) + " " + String(w.when || ""), all)) {
          stats.droppedRows++;
          continue;
        }
        out.watch.push({ when: String(w.when || "").slice(0, 40), what: String(w.what).slice(0, 220) });
      }
      const words = [...out.situation, ...out.background, ...out.market_reaction, ...out.compare, ...out.watch.map((w) => w.what), ...out.numbers.map((n) => `${n.label} ${n.value} ${n.context}`)].join(" ").split(/\s+/).filter(Boolean).length;
      out.words = words;
      return { assessment: out, stats, words };
    }
    function cleanAnalysis(a, corpus, validReports, validEvents) {
      const stats = { droppedSentences: 0, droppedRows: 0 };
      if (!a || !a.thesis) return { analysis: null, stats };
      const th = cleanText([a.thesis], corpus, stats)[0];
      if (!th) return { analysis: null, stats };
      const links = (Array.isArray(a.links) ? a.links : []).filter((l) => l && (l.type === "report" && validReports.has(+l.ref) || l.type === "event" && validEvents.has(String(l.ref)))).map((l) => ({ type: l.type, ref: l.type === "report" ? +l.ref : String(l.ref) }));
      const out = {
        thesis: th,
        body: cleanText(Array.isArray(a.body) ? a.body.filter((x) => typeof x === "string") : [], corpus, stats),
        links,
        counter: cleanText([String(a.counter || "")], corpus, stats)[0] || "",
        conviction: ["LOW", "MEDIUM", "HIGH"].includes(a.conviction) ? a.conviction : "MEDIUM"
      };
      return { analysis: out, stats };
    }
    module2.exports = { cleanAssessment, cleanAnalysis, allPresent, numbers };
  }
});

// lib/synthesise.js
var require_synthesise = __commonJS({
  "lib/synthesise.js"(exports2, module2) {
    var llm = require_llm();
    var { TOPICS } = require_sources();
    var { cleanAssessment, allPresent } = require_verify();
    var { MIN_FULL } = require_sources();
    var SYSTEM = `You are the analyst desk of RECON, a UK-focused economics, banking and markets briefing read by bankers, analysts and investors. Readers are intermediate-to-expert: do not explain basics; give the detail and the numbers.
You receive 3+ items from different sources, supposedly about the SAME event, numbered [1], [2], ...
Source policy: items marked PRIMARY include full text of a public/primary source and are the basis for all detail. Items marked CORROBORATION are third-party outlets for which we hold only a headline and a short feed description: use them only to corroborate facts and to note agreement or differences, never copy their wording, and never use them to add detail that no PRIMARY item contains.
Write ONE corroborated report using ONLY facts stated in the articles.

Hard rules:
- If the articles are NOT about the same event, or fewer than 3 clearly corroborate it, return {"same_event": false}.
- Every number, date, name, vote count and quote-like claim must appear in the provided text. NEVER compute derived figures (differences, percentage changes, averages) and never estimate or round differently. If a figure is not in the text, leave it out.
- Attribute with inline source markers, e.g. "... voted 6-3 to hold [1][3]". Put them at the end of the sentence.
- Do not copy phrasing from the articles; paraphrase. No direct quotes.
- Where outlets differ on a fact or framing, say so in "compare" and name the outlets by marker.
- No speculation, no opinion, no advice here. (Opinion lives in a separate step.)
- Depth: aim for roughly 600-900 words across the assessment sections when the sources contain that much detail. Never pad. If the sources are thin, write less.
- Topic must be one of: ${TOPICS.join(" | ")}.
- uk_relevance: 5 = about the UK economy, UK banks, FTSE or the Bank of England; 3 = overseas event with a UK impact stated in the articles; 1-2 = no real UK angle.
- confidence: HIGH = sources agree on the core facts; MEDIUM = minor differences; LOW = material conflict or thin detail.

Return ONLY JSON:
{"same_event":true,"uk_relevance":1-5,"topic":"...","headline":"<=80 chars","summary":"<=50 words: the bottom line up front","key_points":["3-4 bullets, <=14 words each"],"why_it_matters":"<=35 words, the UK angle (gilts, sterling, FTSE, banks, mortgages, Bank Rate)","confidence":"HIGH|MEDIUM|LOW","disagreements":["short, optional"],
"assessment":{"situation":["2-4 detailed paragraphs: what happened, who said what, sequence, magnitude"],"numbers":[{"label":"e.g. Bank Rate","value":"exactly as written, e.g. 3.75%","source":1,"context":"<=14 words"}],"background":["1-2 paragraphs of context found in the articles"],"market_reaction":["0-2 paragraphs on sterling, gilts, equities, pricing - only if in the articles"],"compare":["how outlets agree/differ, with markers"],"watch":[{"when":"date or period, as in the articles","what":"what to watch"}]}}
Include up to 10 rows in "numbers", most decision-relevant first.`;
    var TEXT_PER_SOURCE = +(process.env.TEXT_PER_SOURCE || 6e3);
    var isFull = (a) => a.tier === "full" && a.full_text && a.full_text.length > 200;
    var textOf = (a) => (isFull(a) ? a.full_text : a.snippet || "").slice(0, isFull(a) ? TEXT_PER_SOURCE : 400);
    var BRIEF_NOTE = '\nMODE: BRIEF. No PRIMARY full text is available for this event, so set "assessment" to null. Still return same_event, uk_relevance, topic, headline, summary, key_points, why_it_matters, confidence and disagreements, using only the headlines and snippets.';
    async function synthesise(articles) {
      if (process.env.DEMO === "1" || !llm.configured()) return stub(articles);
      const texts = articles.map((a) => `${a.title}. ${textOf(a)}`);
      const fullCount = articles.filter(isFull).length, brief = fullCount < MIN_FULL;
      const body = articles.map((a, i) => `[${i + 1}] ${isFull(a) ? "PRIMARY" : "CORROBORATION"} | ${a.source} | ${a.published_at}
TITLE: ${a.title}
TEXT: ${textOf(a) || "(headline only)"}`).join("\n\n");
      const json = await llm.json(SYSTEM + (brief ? BRIEF_NOTE : ""), body, { max: brief ? 1200 : 5e3 });
      if (!json || !json.same_event) return null;
      if (!TOPICS.includes(json.topic)) json.topic = "MARKETS";
      if (!["HIGH", "MEDIUM", "LOW"].includes(json.confidence)) json.confidence = "MEDIUM";
      json.uk_relevance = +json.uk_relevance || 0;
      const { assessment, stats } = brief ? { assessment: null, stats: { droppedSentences: 0, droppedRows: 0 } } : cleanAssessment(json.assessment, texts);
      json.assessment = assessment;
      json.verify = stats;
      json.sourceTexts = texts;
      json.depth = brief ? "BRIEF" : "FULL";
      const bs = { droppedSentences: 0 };
      for (const k of ["summary", "why_it_matters"]) {
        if (json[k] && !allPresent(json[k], texts.join(" "))) {
          json[k] = "";
          bs.droppedSentences++;
        }
      }
      if (!json.summary) return null;
      return json;
    }
    function stub(articles) {
      return {
        same_event: true,
        uk_relevance: 5,
        topic: "MARKETS",
        headline: articles[0].title.slice(0, 80),
        summary: `[stub] ${articles.length} outlets covered this. Add ANTHROPIC_API_KEY to enable AI synthesis.`,
        key_points: articles.map((a) => `${a.source}: ${a.title}`.slice(0, 120)),
        why_it_matters: "[stub] Synthesis disabled.",
        disagreements: [],
        confidence: "MEDIUM",
        assessment: null,
        sourceTexts: articles.map((a) => a.title)
      };
    }
    module2.exports = synthesise;
  }
});

// lib/analyse.js
var require_analyse = __commonJS({
  "lib/analyse.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var db2 = require_db();
    var llm = require_llm();
    var { cleanAnalysis } = require_verify();
    var SYSTEM = `You write the "RECON Analysis" for RECON, a UK economics, banking and markets briefing for finance professionals. It is the desk's own opinion, in the style of a sharp insider's take: direct, specific, a little wry, never waffly.

You are given (1) one REPORT, (2) other recent RECON REPORTS (with ids), (3) the UPCOMING EVENTS calendar (with ids), and (4) current policy RATES.

Rules:
- Take a clear view in one sentence (the thesis). Then 2-3 short paragraphs of reasoning (150-220 words total) that connect this report to other recent reports and/or upcoming events where the link is genuine. If nothing genuinely connects, say so; never force a link.
- Use ONLY facts present in the supplied material. Never invent statistics, quotes, dates, events or sources. Every number you use must appear in the supplied material. Do not compute new figures.
- It is analysis and opinion, not fact: frame it as the desk's view. Give a counter-case (what would make this view wrong).
- No investment advice: no buy/sell/hold recommendations, no price targets.
- conviction: LOW | MEDIUM | HIGH, reflecting how strongly the supplied evidence supports the view.
- links: list only ids you actually used: {"type":"report","ref":<report id>} or {"type":"event","ref":"<event id>"}.

Return ONLY JSON: {"thesis":"...","body":["para","para"],"links":[{"type":"event","ref":"..."}],"counter":"one or two sentences","conviction":"MEDIUM"}`;
    function loadJSON(f, d) {
      try {
        return JSON.parse(fs.readFileSync(f === "rates.json" ? require_paths().RATES : require_files().find(f), "utf8"));
      } catch {
        return d;
      }
    }
    async function analyse(storyId) {
      const s = db2.prepare("SELECT * FROM stories WHERE id=?").get(storyId);
      if (!s) return null;
      const others = db2.prepare(`SELECT id, topic, headline, summary FROM stories WHERE id != ? AND updated_at >= datetime('now','-72 hours') ORDER BY updated_at DESC LIMIT 12`).all(storyId);
      const cal = (loadJSON("calendar.json", { events: [] }).events || []).filter((e) => new Date(e.date) > /* @__PURE__ */ new Date());
      const rates = loadJSON("rates.json", { banks: [] });
      const a = s.assessment ? JSON.parse(s.assessment) : null;
      const report = [
        `HEADLINE: ${s.headline}`,
        `SUMMARY: ${s.summary}`,
        `UK ANGLE: ${s.why_it_matters}`,
        a ? `SITUATION: ${a.situation.join(" ")}
NUMBERS: ${a.numbers.map((n) => `${n.label} ${n.value}`).join("; ")}
BACKGROUND: ${a.background.join(" ")}
MARKET: ${a.market_reaction.join(" ")}` : ""
      ].join("\n");
      const ctxOthers = others.map((o) => `- id ${o.id} [${o.topic}] ${o.headline}: ${o.summary}`).join("\n") || "(none)";
      const human = (iso) => {
        const d = new Date(iso);
        return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
      };
      const ctxCal = cal.map((e) => `- id ${e.id} | ${human(e.date)} | ${e.label}`).join("\n") || "(none)";
      const ctxRates = rates.banks.map((b) => `- ${b.name}: ${b.rateLabel} ${b.rate}${b.unit}; ${b.lastMoveDetail}; next ${b.nextLabel}; market: ${b.market}`).join("\n");
      const prompt = `REPORT (id ${s.id}):
${report}

OTHER RECENT RECON REPORTS:
${ctxOthers}

UPCOMING EVENTS:
${ctxCal}

CURRENT POLICY RATES:
${ctxRates}`;
      const raw = await llm.json(SYSTEM, prompt, { max: 1500, model: process.env.ANALYSIS_MODEL });
      const { analysis, stats } = cleanAnalysis(raw, prompt, new Set(others.map((o) => o.id)), new Set(cal.map((e) => e.id)));
      if (!analysis) {
        console.log(`  - analysis ${s.id} rejected (unverifiable figures)`);
        return null;
      }
      db2.prepare("UPDATE stories SET analysis=? WHERE id=?").run(JSON.stringify(analysis), s.id);
      if (stats.droppedSentences) console.log(`  - analysis ${s.id}: removed ${stats.droppedSentences} unverifiable sentence(s)`);
      return analysis;
    }
    module2.exports = analyse;
  }
});

// lib/releases.js
var require_releases = __commonJS({
  "lib/releases.js"(exports2, module2) {
    var crypto = require("crypto");
    var db2 = require_db();
    var llm = require_llm();
    var { fillFullText } = require_fulltext();
    var { cleanAssessment, allPresent } = require_verify();
    var { TOPICS } = require_sources();
    var PRIORITY = ["ONS", "OBR", "Bank of England", "HM Treasury", "FCA", "HMRC", "CMA", "Federal Reserve", "ECB"];
    var PER_SOURCE = +(process.env.RELEASES_PER_SOURCE || 3);
    var MAX = +(process.env.MAX_RELEASES || 10);
    var WINDOW_H = +(process.env.RELEASE_WINDOW_HOURS || 48);
    var SYSTEM = `You are the analyst desk of RECON, a UK-focused economics, banking and markets briefing for finance professionals (intermediate to expert: no basics, give the detail and the numbers).
You receive ONE official publication (full text) from a primary source: a statistics release, fiscal forecast, central-bank statement, regulator notice or Treasury publication.
Write a report on it using ONLY facts stated in that text.

Hard rules:
- Every number, date and name must appear in the provided text. NEVER compute derived figures (changes, averages, percentages) or round differently. If a figure is not in the text, leave it out.
- Paraphrase; no direct quotes; add inline marker [1] at the end of sentences (there is a single source).
- No speculation, opinion or advice here (opinion lives in a separate step).
- Depth: roughly 250-600 words across the assessment sections depending on how much the document contains. Never pad.
- If the publication is not about economics, finance, banking, markets, tax or fiscal/monetary policy, or has no UK relevance (uk_relevance < 3 and not a Fed/ECB item that matters to UK rates), return {"skip":true}.
- topic must be one of: ${TOPICS.join(" | ")}.
Return ONLY JSON:
{"skip":false,"uk_relevance":1-5,"topic":"...","headline":"<=80 chars, plain statement of the news","summary":"<=50 words, bottom line up front","key_points":["3-4 bullets <=14 words"],"why_it_matters":"<=35 words, the UK angle","assessment":{"situation":["1-3 paragraphs: what was published, the headline figures, what changed"],"numbers":[{"label":"...","value":"exactly as written","source":1,"context":"<=14 words"}],"background":["0-2 paragraphs of context from the document"],"market_reaction":[],"compare":[],"watch":[{"when":"date as written","what":"next step, release or decision mentioned in the document"}]}}
Up to 10 rows in "numbers", most decision-relevant first.`;
    var hash = (u) => "rel-" + crypto.createHash("sha1").update(u).digest("hex").slice(0, 16);
    async function runReleases() {
      if (process.env.DEMO === "1" || !llm.configured()) return 0;
      const since = new Date(Date.now() - WINDOW_H * 36e5).toISOString();
      const rows = db2.prepare(`SELECT * FROM articles WHERE tier='full' AND published_at >= ? ORDER BY published_at DESC`).all(since);
      const inStory = db2.prepare(`SELECT 1 FROM stories WHERE sources LIKE ?`), seen = db2.prepare("SELECT 1 FROM release_seen WHERE url=?");
      const mark = (u, o) => db2.prepare("INSERT OR REPLACE INTO release_seen (url,outcome) VALUES (?,?)").run(u, o);
      const rank = (n) => {
        const i = PRIORITY.indexOf(n);
        return i < 0 ? 99 : i;
      };
      const perSrc = {}, picked = [];
      for (const a of rows.sort((x, y) => rank(x.source) - rank(y.source) || y.published_at.localeCompare(x.published_at))) {
        if (picked.length >= MAX || (perSrc[a.source] || 0) >= PER_SOURCE) continue;
        if (seen.get(a.url) || inStory.get("%" + a.url + "%")) continue;
        perSrc[a.source] = (perSrc[a.source] || 0) + 1;
        picked.push(a);
      }
      const cols = "cluster_key,kind,topic,headline,summary,key_points,why_it_matters,disagreements,confidence,sources,source_count,assessment,read_mins";
      const ins = db2.prepare(`INSERT OR IGNORE INTO stories (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`);
      let made = 0;
      for (const a of picked) {
        try {
          await fillFullText([a]);
          const text = a.full_text && a.full_text.length >= 400 ? a.full_text : "";
          if (!text && (a.snippet || "").length < 120) {
            mark(a.url, "no-text");
            continue;
          }
          const doc = `${a.title}. ${text || a.snippet}`;
          const j = await llm.json(SYSTEM, `[1] PRIMARY | ${a.source} | ${a.published_at}
TITLE: ${a.title}
TEXT: ${(text || a.snippet).slice(0, 7e3)}`, { max: 3500 });
          if (!j || j.skip || (+j.uk_relevance || 0) < 3) {
            mark(a.url, "skipped");
            continue;
          }
          if (!TOPICS.includes(j.topic)) j.topic = "UK ECONOMY";
          if (!j.summary || !allPresent(j.summary, doc)) {
            mark(a.url, "summary-unverifiable");
            continue;
          }
          if (j.why_it_matters && !allPresent(j.why_it_matters, doc)) j.why_it_matters = "";
          const { assessment, stats } = text ? cleanAssessment(j.assessment, [doc]) : { assessment: null, stats: {} };
          const mins = assessment ? Math.max(1, Math.round(assessment.words / 200)) : null;
          if (stats.droppedSentences || stats.droppedRows) console.log(`  - release verification removed ${stats.droppedSentences} sentence(s), ${stats.droppedRows} row(s): ${a.title}`);
          const src = JSON.stringify([{ name: a.source, url: a.url, title: a.title }]);
          made += ins.run(hash(a.url), "RELEASE", j.topic, String(j.headline || a.title).slice(0, 120), j.summary, JSON.stringify(j.key_points || []), j.why_it_matters || "", "[]", "PRIMARY", src, 1, assessment ? JSON.stringify(assessment) : null, mins).changes;
          mark(a.url, "published");
        } catch (e) {
          console.log("  ! release failed:", a.title, e.message);
        }
      }
      console.log(`[releases] ${made} official release(s) published from ${picked.length} candidate(s)`);
      return made;
    }
    module2.exports = { runReleases };
  }
});

// lib/pipeline.js
var require_pipeline = __commonJS({
  "lib/pipeline.js"(exports2, module2) {
    var db2 = require_db();
    var ingest = require_ingest();
    var { clusterAdaptive } = require_cluster();
    var { fillFullText } = require_fulltext();
    var synthesise = require_synthesise();
    var analyse = require_analyse();
    var { runReleases } = require_releases();
    var WINDOW_H = +(process.env.WINDOW_HOURS || 36);
    var MIN_WORDS = +(process.env.MIN_ASSESSMENT_WORDS || 150);
    var lonDow = () => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 })[new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(/* @__PURE__ */ new Date())];
    async function run({ skipIngest = false } = {}) {
      const ing = skipIngest ? { stats: [] } : await ingest();
      const wins = [.../* @__PURE__ */ new Set([[0, 1].includes(lonDow()) ? Math.max(WINDOW_H, 72) : WINDOW_H, 72])];
      let arts = [], clusters = [], used = null;
      for (const h of wins) {
        const since = new Date(Date.now() - h * 36e5).toISOString();
        arts = db2.prepare(`SELECT * FROM articles WHERE published_at >= ? ORDER BY published_at DESC`).all(since);
        used = clusterAdaptive(arts);
        clusters = used.clusters.slice(0, +(process.env.MAX_STORIES || 25));
        used.hours = h;
        if (clusters.length >= +(process.env.MIN_STORIES_TARGET || 4)) break;
      }
      console.log(`[pipeline] ${arts.length} articles (last ${used.hours}h) -> ${clusters.length} corroborated clusters (similarity ${used.th})`);
      const bySrc = {};
      arts.forEach((a) => {
        bySrc[a.source] = (bySrc[a.source] || 0) + 1;
      });
      try {
        db2.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('status', ?)").run(JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), windowHours: used.hours, similarity: used.th, articles: arts.length, clusters: clusters.length, clusterSizes: clusters.map((c) => c.articles.length), articlesBySource: bySrc, feeds: ing.stats || [] }));
      } catch {
      }
      const findExisting = db2.prepare(`SELECT id, source_count FROM stories WHERE sources LIKE ?`);
      const cols = "topic,headline,summary,key_points,why_it_matters,disagreements,confidence,sources,source_count,assessment,read_mins";
      const ins = db2.prepare(`INSERT INTO stories (cluster_key,${cols}) VALUES (?,${cols.split(",").map(() => "?").join(",")})`);
      const upd = db2.prepare(`UPDATE stories SET ${cols.split(",").map((c) => c + "=?").join(",")},updated_at=datetime('now') WHERE id=?`);
      const touched = [];
      for (const c of clusters) {
        let existing = null;
        for (const a of c.articles) {
          existing = findExisting.get("%" + a.url + "%");
          if (existing) break;
        }
        if (existing && c.articles.length - existing.source_count < +(process.env.RESYNTH_MIN_GROWTH || 1)) continue;
        try {
          await fillFullText(c.articles);
          const s = await synthesise(c.articles);
          if (!s) continue;
          if (s.uk_relevance != null && s.uk_relevance < 3) {
            console.log("  - skipped (low UK relevance):", s.headline);
            continue;
          }
          const A = s.assessment, mins = A ? Math.max(1, Math.round(A.words / 200)) : null;
          if (A && A.words < MIN_WORDS) console.log(`  - thin sources: ${A.words} words for "${s.headline}"`);
          if (s.verify && (s.verify.droppedSentences || s.verify.droppedRows)) console.log(`  - verification removed ${s.verify.droppedSentences} sentence(s), ${s.verify.droppedRows} row(s) for "${s.headline}"`);
          const srcs = JSON.stringify(c.articles.map((a) => ({ name: a.source, url: a.url, title: a.title })));
          const vals = [s.topic, s.headline, s.summary, JSON.stringify(s.key_points || []), s.why_it_matters || "", JSON.stringify(s.disagreements || []), s.confidence, srcs, c.articles.length, A ? JSON.stringify(A) : null, mins];
          let id;
          if (existing) {
            upd.run(...vals, existing.id);
            id = existing.id;
          } else {
            id = ins.run(c.key, ...vals).lastInsertRowid;
          }
          touched.push(+id);
        } catch (e) {
          console.log("  ! synth failed:", e.message);
        }
      }
      console.log(`[pipeline] ${touched.length} reports written/updated`);
      await runReleases().catch((e) => console.log("  ! releases failed:", e.message));
      const pending = db2.prepare(`SELECT id FROM stories WHERE analysis IS NULL AND updated_at >= datetime('now','-72 hours')`).all().map((r) => r.id);
      if (process.env.DEMO !== "1" && require_llm().configured()) {
        const ids = [.../* @__PURE__ */ new Set([...touched, ...pending])];
        const rank = (id) => {
          const r = db2.prepare("SELECT kind, source_count FROM stories WHERE id=?").get(id);
          return -(r.source_count + (r.kind === "RELEASE" ? 1.5 : 0));
        };
        for (const id of ids.sort((a, b) => rank(a) - rank(b)).slice(0, +(process.env.ANALYSIS_MAX_PER_RUN || 1e3))) {
          try {
            await analyse(id);
          } catch (e) {
            console.log("  ! analysis failed:", e.message);
          }
        }
      }
      return touched.length;
    }
    module2.exports = run;
    if (require.main === module2) {
      require("dotenv").config();
      run().then(() => process.exit(0));
    }
  }
});

// lib/rateprobability.js
var require_rateprobability = __commonJS({
  "lib/rateprobability.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var db2 = require_db();
    var RATES = require_paths().RATES;
    var BASE = process.env.RATEPROB_BASE || "https://rateprobability.com";
    var UA = "ReconBot/1.0 (+market pricing, attributed; contact via site)";
    var PAGES = { BOE: "boe", FED: "fed", ECB: "ecb" };
    var TZ = { EST: -5, EDT: -4, CST: -6, CDT: -5, GMT: 0, UTC: 0, BST: 1, CET: 1, CEST: 2, ET: -5 };
    var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    var toText = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
    function parseWhen(dateStr, timeStr, tz) {
      const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(dateStr), t = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(timeStr || "12:00 PM");
      if (!m || !t) return null;
      const mon = MONTHS.indexOf(m[1].toLowerCase());
      if (mon < 0) return null;
      let h = +t[1] % 12 + (/pm/i.test(t[3]) ? 12 : 0);
      const off = TZ[(tz || "GMT").toUpperCase()] ?? 0;
      return new Date(Date.UTC(+m[3], mon, +m[2], h - off, +t[2])).toISOString();
    }
    function parsePage(html) {
      const text = toText(html), out = { rate: null, rateNum: null, nextAt: null, dir: null, pct: null, bp: null, twelveBp: null, hikes: null };
      let m = /Current Rate\s*:?\s*(\d+\.\d+)\s*%\s*(?:[-–to]+\s*(\d+\.\d+)\s*%)?/i.exec(text) || /(?:Bank Rate|Fed(?:eral)? Funds(?: (?:Target )?Rate)?|Deposit (?:Facility )?Rate|Target Range)\s*:?\s*(\d+\.\d+)\s*%\s*(?:[-–to]+\s*(\d+\.\d+)\s*%)?/i.exec(text);
      if (m) {
        out.rate = m[2] ? `${m[1]}\u2013${m[2]}` : m[1];
        out.rateNum = +(m[2] || m[1]);
      }
      m = /next [^.]{0,80}?(?:decision|meeting)[^.]{0,40}? is on ([A-Za-z]+,? [A-Za-z]+ \d{1,2}, \d{4}),? at (\d{1,2}:\d{2} [AP]M)\s*([A-Z]{2,4})?/i.exec(text);
      if (m) out.nextAt = parseWhen(m[1], m[2], m[3]);
      m = /implies an? (\d+(?:\.\d+)?)% chance of an? (\d+(?:\.\d+)?)\s*bp (hike|cut)/i.exec(text);
      if (m) {
        out.pct = +m[1];
        out.bp = +m[2];
        out.dir = m[3].toUpperCase() === "HIKE" ? "HIKE" : "CUT";
      } else if (m = /implies an? (\d+(?:\.\d+)?)% chance of (?:no change|a hold|unchanged)/i.exec(text)) {
        out.pct = +m[1];
        out.dir = "HOLD";
        out.bp = 0;
      }
      m = /net (-?\d+(?:\.\d+)?)\s*bp of (hikes|cuts)(?:, or (\d+(?:\.\d+)?))?/i.exec(text);
      if (m) {
        out.twelveBp = (/cut/i.test(m[2]) ? -1 : 1) * +m[1];
        out.hikes = m[3] ? +m[3] : null;
      }
      return out;
    }
    var valid = (p) => p && p.rateNum != null && p.rateNum > 0 && p.rateNum < 25 && p.nextAt && p.pct != null && p.pct >= 0 && p.pct <= 100;
    async function robotsAllows(pathname) {
      try {
        const r = await fetch(BASE + "/robots.txt", { headers: { "User-Agent": UA } });
        if (!r.ok) return true;
        let applies = false, ok = true;
        for (const line of (await r.text()).split(/\r?\n/)) {
          const l = line.split("#")[0].trim();
          if (!l) continue;
          const [k, ...v] = l.split(":");
          const key = k.toLowerCase(), val = v.join(":").trim();
          if (key === "user-agent") applies = val === "*" || /recon/i.test(val);
          else if (applies && key === "disallow" && val && pathname.startsWith(val)) ok = false;
        }
        return ok;
      } catch {
        return true;
      }
    }
    async function getHTML(url) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow" });
        if (r.ok) {
          const h = await r.text();
          if (/chance of/i.test(h)) return h;
        }
      } catch {
      }
      if (process.env.RATES_BROWSER === "1") {
        try {
          const { chromium } = require("playwright");
          const b = await chromium.launch();
          const p = await b.newPage({ userAgent: UA });
          await p.goto(url, { waitUntil: "networkidle", timeout: 3e4 });
          const h = await p.content();
          await b.close();
          return h;
        } catch {
        }
      }
      throw new Error("page unavailable (blocked or layout changed)");
    }
    var fmtMarket = (p) => {
      if (p.dir === "HOLD") return `~${Math.round(p.pct)}% priced for no change`;
      const sign = p.dir === "HIKE" ? "+" : "-";
      return p.pct >= 50 ? `~${Math.round(p.pct)}% priced for ${sign}${p.bp}bp` : `~${Math.round(p.pct)}% priced for ${sign}${p.bp}bp (hold is base case)`;
    };
    var label = (iso) => {
      const d = new Date(iso);
      return `${String(d.getUTCDate()).padStart(2, "0")} ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()]}`;
    };
    function merge(bank, p, now = /* @__PURE__ */ new Date()) {
      const notes = [];
      if (bank.rate && bank.rateNum != null && Math.abs(p.rateNum - bank.rateNum) > 1e-3) {
        const dir = p.rateNum > bank.rateNum ? "HIKE" : "CUT";
        bank.lastMove = dir;
        bank.lastMoveDetail = `Moved to ${p.rate}% (auto-detected ${now.toISOString().slice(0, 10)})`;
        if (bank.sub) {
          bank.sub = "";
          notes.push("sub-rates cleared: update manually");
        }
        notes.push(`rate change detected ${bank.rate} -> ${p.rate}`);
      }
      const official2 = bank.officialAt && now - new Date(bank.officialAt) < 36 * 36e5;
      if (!official2) {
        bank.rate = p.rate;
        bank.rateNum = p.rateNum;
        bank.next = p.nextAt;
        bank.nextLabel = label(p.nextAt);
      }
      bank.market = fmtMarket(p);
      bank.marketProb = { dir: p.dir, pct: p.pct, bp: p.bp, twelveBp: p.twelveBp };
      bank.marketSource = { name: "RateProbability", url: `${BASE}/${PAGES[bank.code]}` };
      bank.updatedAt = now.toISOString();
      if (!official2) bank.stale = false;
      return notes;
    }
    async function refresh({ fetchHTML = getHTML } = {}) {
      const file = JSON.parse(fs.readFileSync(RATES, "utf8"));
      const results = {};
      for (const bank of file.banks) {
        const slug = PAGES[bank.code];
        if (!slug) continue;
        try {
          if (!await robotsAllows("/" + slug)) throw new Error("disallowed by robots.txt");
          const p = parsePage(await fetchHTML(`${BASE}/${slug}`));
          if (!valid(p)) throw new Error("parse failed: " + JSON.stringify(p));
          const notes = merge(bank, p);
          db2.prepare("INSERT INTO rate_snapshots (bank, rate, prob_dir, prob_pct, prob_bp, next_at) VALUES (?,?,?,?,?,?)").run(bank.code, p.rateNum, p.dir, p.pct, p.bp, p.nextAt);
          results[bank.code] = { ok: true, rate: p.rate, pct: p.pct, notes };
        } catch (e) {
          delete bank.market;
          delete bank.marketProb;
          delete bank.marketSource;
          if (!bank.officialAt) bank.stale = true;
          results[bank.code] = { ok: false, error: e.message.slice(0, 160) };
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      const any = Object.values(results).some((r) => r.ok);
      if (any) file.asOf = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const tmp = RATES + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
      fs.renameSync(tmp, RATES);
      console.log("[rates]", JSON.stringify(results));
      return results;
    }
    module2.exports = { refresh, parsePage, merge, valid, toText, parseWhen };
    if (require.main === module2) {
      require("dotenv").config();
      if (process.argv[2] === "probe") {
        (async () => {
          for (const [code, slug] of Object.entries(PAGES)) {
            try {
              const h = await getHTML(`${BASE}/${slug}`);
              console.log(code, JSON.stringify(parsePage(h)), "\n  text sample:", toText(h).slice(0, 300));
            } catch (e) {
              console.log(code, "FAILED", e.message);
            }
          }
          process.exit(0);
        })();
      } else refresh().then(() => process.exit(0));
    }
  }
});

// lib/newsletter.js
var require_newsletter = __commonJS({
  "lib/newsletter.js"(exports2, module2) {
    var nodemailer = require("nodemailer");
    var fs = require("fs");
    var path = require("path");
    var db2 = require_db();
    var BASE = () => process.env.BASE_URL || "http://localhost:3000";
    var FROM = () => process.env.MAIL_FROM || "RECON <briefing@localhost>";
    var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function sendViaResend(to, subject, html, text, headers) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM(), to: [to], subject, html, text, headers })
        });
        if (r.ok) return;
        if (r.status === 429 || r.status >= 500) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      throw new Error("Resend: gave up after retries");
    }
    var transport;
    async function send(to, subject, html, text, headers = {}) {
      if (process.env.RESEND_API_KEY) return sendViaResend(to, subject, html, text, headers);
      if (!process.env.SMTP_HOST) {
        const dir = path.join(require_paths().DATA, "outbox");
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, `${Date.now()}-${to.replace(/[^a-z0-9@.]/gi, "_")}.html`);
        fs.writeFileSync(f, `<!-- To: ${esc(to)} | Subject: ${esc(subject)} -->
${html}`);
        console.log("[mail:dev] ->", f);
        return;
      }
      transport = transport || nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await transport.sendMail({ from: FROM(), to, subject, html, text, headers });
    }
    async function sendConfirmation(sub) {
      const link2 = `${BASE()}/confirm?token=${sub.token}`;
      await send(
        sub.email,
        "RECON \xB7 Confirm your subscription",
        shell(`<p style="margin:0 0 16px">Confirm to receive the daily briefing.</p><p><a href="${link2}" style="background:#fff;color:#000;padding:12px 18px;text-decoration:none;font-weight:700;letter-spacing:.12em;font-size:12px">CONFIRM SUBSCRIPTION</a></p><p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, ignore this email and you won't be added.</p>`),
        `Confirm your subscription: ${link2}`
      );
    }
    function shell(inner) {
      return `<div style="background:#000;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#b3b3b3"><div style="max-width:600px;margin:auto;border:1px solid #242424;padding:28px"><div style="color:#fff;letter-spacing:.3em;font-size:13px;font-weight:700;margin-bottom:4px">RECON</div><div style="color:#7a7a7a;letter-spacing:.14em;font-size:10px;margin-bottom:20px">UK MORNING BRIEF</div>${inner}</div></div>`;
    }
    var DAILY_STORIES = () => +(process.env.DAILY_STORIES || 3);
    var loadRates = () => {
      try {
        return JSON.parse(fs.readFileSync(require_paths().RATES, "utf8"));
      } catch {
        return null;
      }
    };
    var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    var readMins = (stories) => Math.max(1, Math.round(stories.reduce((n, s) => n + [s.headline, s.summary, s.why_it_matters, ...JSON.parse(s.key_points)].join(" ").split(/\s+/).length, 0) / 200));
    var T = { bg: "#000000", ink: "#f2f2f2", sub: "#b3b3b3", mute: "#7a7a7a", line: "#242424", line2: "#3a3a3a", panel: "#0a0a0a" };
    var SANS = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
    var MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'Courier New',monospace";
    var label = (txt, extra = "") => `<span style="font-family:${SANS};font-size:11px;line-height:1;letter-spacing:.14em;text-transform:uppercase;color:${T.mute};${extra}">${txt}</span>`;
    var mono = (txt, extra = "") => `<span style="font-family:${MONO};font-size:11px;letter-spacing:.04em;color:${T.mute};${extra}">${txt}</span>`;
    var strip = (pos) => `<div style="background:${T.ink};color:#000000;text-align:center;font-family:${SANS};font-weight:600;font-size:9px;line-height:1;letter-spacing:.2em;padding:6px 8px;text-transform:uppercase">Unclassified // Open-source intelligence // For information only</div>`;
    var sec = (txt) => `<div style="margin:30px 0 14px;padding-bottom:9px;border-bottom:1px solid ${T.line}">${label(txt)}</div>`;
    var min = (h) => h.replace(/>\s+</g, "><").replace(/\s*\n\s*/g, " ");
    var dtg = (d = /* @__PURE__ */ new Date()) => {
      const p = (n) => String(n).padStart(2, "0");
      return `DTG ${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
    };
    var tminus = (iso) => {
      const ms = new Date(iso) - Date.now();
      if (isNaN(ms)) return "";
      if (ms <= 0) return "DECISION DUE";
      const m = Math.floor(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
      const p = (n) => String(n).padStart(2, "0");
      return d > 0 ? `T-${d}D ${p(h)}H` : `T-${p(h)}H ${p(mm)}M`;
    };
    var ago = (iso) => {
      const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 6e4));
      return m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago";
    };
    var squares = (c) => {
      const n = { HIGH: 3, MEDIUM: 2, LOW: 1 }[c] || 2;
      return [1, 2, 3].map((i) => `<span style="color:${i <= n ? T.ink : T.mute}">${i <= n ? "&#9632;" : "&#9633;"}</span>`).join("&nbsp;");
    };
    var tag = (txt, kind) => kind === "solid" ? `<span style="font-family:${MONO};font-weight:700;font-size:9.5px;letter-spacing:.16em;background:${T.ink};color:#000000;padding:2px 6px;border:1px solid ${T.ink}">${txt}</span>` : `<span style="font-family:${MONO};font-weight:700;font-size:9.5px;letter-spacing:.16em;color:${kind === "ink" ? T.ink : T.sub};padding:2px 6px;border:1px solid ${kind === "ink" ? T.ink : T.line2}">${txt}</span>`;
    function kpiBoard() {
      const r = loadRates();
      if (!r || !r.banks || !r.banks.length) return "";
      const row = (k, v) => `<tr><td width="74" valign="top" style="padding:0;font-family:${SANS};font-size:12.5px;line-height:1.4">${label(k, "font-size:10px")}</td><td valign="top" style="padding:0 0 7px;font-family:${SANS};font-size:12.5px;line-height:1.4;color:${T.sub}">${v}</td></tr>`;
      const card = (b, i) => {
        const nx = new Date(b.next), when = isNaN(nx) ? esc(b.nextLabel || "") : `${String(nx.getUTCDate()).padStart(2, "0")} ${MON[nx.getUTCMonth()]}`;
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${T.panel};border:1px solid ${T.line};margin:0 0 10px"><tr><td style="padding:16px 18px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td>${label(`${esc(b.code)} &middot; ${esc(b.rateLabel)}`)}</td><td align="right">${mono(`RATE-0${i + 1}`)}</td></tr></table>
<div style="margin-top:14px;font-family:${SANS};font-weight:600;font-size:34px;line-height:1.1;letter-spacing:-.03em;color:#ffffff">${esc(b.rate)}<span style="font-size:16px;font-weight:500;color:${T.sub}">${esc(b.unit || "%")}</span></div><div style="margin-top:4px;min-height:14px">${mono(esc(b.sub || ""), "font-size:10.5px")}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border-top:1px solid ${T.line}"><tr><td style="padding-top:10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${row("Last", `${tag(esc(b.lastMove), "ink")} ${esc(b.lastMoveDetail || "")}`)}${row("Next", `<span style="font-family:${MONO};color:${T.ink}">${tminus(b.next)}</span> &middot; ${when}`)}${row("Market", `${esc(b.market || "")}${b.stale ? ` ${tag("STALE", "dim")}` : ""}`)}</table></td></tr></table></td></tr></table>`;
      };
      return `${sec("&sect;1 &middot; Policy rates")}${r.banks.map(card).join("")}<div style="margin:-2px 0 0">${mono(`AS OF ${String(r.asOf || "").toUpperCase()} &middot; MARKET PRICING IS INDICATIVE`, "font-size:10.5px")}</div>`;
    }
    function storiesFor(topics, now = Date.now()) {
      const since = new Date(now - 30 * 36e5).toISOString().replace("T", " ").slice(0, 19);
      let rows = db2.prepare(`SELECT * FROM stories WHERE updated_at >= ?`).all(since);
      if (topics && topics.length) rows = rows.filter((r) => topics.includes(r.topic));
      const base = (r) => (r.kind === "RELEASE" ? 1.5 : r.source_count) + (r.analysis ? 1.5 : 0) + ({ HIGH: 1, MEDIUM: 0.5, PRIMARY: 0.8 }[r.confidence] || 0) + (r.read_mins ? 0.5 : 0);
      const picked = [];
      while (picked.length < DAILY_STORIES() && rows.length) {
        const sc = rows.map((r) => [r, base(r) - (picked.some((p) => p.topic === r.topic) ? 1.5 : 0)]).sort((a, b) => b[1] - a[1]);
        picked.push(sc[0][0]);
        rows = rows.filter((r) => r.id !== sc[0][0].id);
      }
      const extra = +(process.env.BRIEF_RELEASES || 0);
      const releases = extra ? rows.filter((r) => r.kind === "RELEASE").slice(0, extra) : [];
      return { reports: picked, releases, all: [...picked, ...releases] };
    }
    var link = (id) => process.env.SITE_URL || process.env.BASE_URL ? `${(process.env.SITE_URL || process.env.BASE_URL).replace(/\/$/, "")}/#rpt-${id}` : "";
    var precOf = (s) => s.kind === "RELEASE" ? ["OFFICIAL", "solid"] : s.source_count >= 6 ? ["FLASH", "solid"] : s.source_count >= 4 ? ["PRIORITY", "ink"] : ["ROUTINE", "dim"];
    function storyHTML(s) {
      const pts = JSON.parse(s.key_points), srcs = JSON.parse(s.sources), an = s.analysis ? JSON.parse(s.analysis) : null, l = link(s.id), [pl, pk] = precOf(s);
      const metaRight = s.kind === "RELEASE" ? `${label("Source", "margin-right:8px")}${mono(`${esc((srcs[0] || {}).name || "")} &middot; PRIMARY DOCUMENT`, "color:" + T.sub)}` : `${label("Sources")}&nbsp;${mono(String(s.source_count), "color:" + T.sub)} &nbsp;&nbsp; ${label("Confidence")}&nbsp;${squares(s.confidence)}&nbsp;${mono(esc(s.confidence), "color:" + T.sub)}`;
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid ${T.line};table-layout:fixed"><tr><td style="padding:26px 0 24px;word-wrap:break-word;overflow-wrap:break-word">
<div style="margin-bottom:12px">${mono(`RPT-${String(s.id).padStart(4, "0")}`)}&nbsp;&nbsp;${tag(pl, pk)}&nbsp;&nbsp;${label(esc(s.topic))}&nbsp;&nbsp;${mono(ago(s.updated_at.replace(" ", "T") + "Z"))}</div>
<div style="font-family:${SANS};font-weight:600;font-size:21px;line-height:1.3;letter-spacing:-.015em;color:#ffffff;margin:0 0 10px">${esc(s.headline)}</div>
<div style="font-family:${SANS};font-size:15px;line-height:1.6;color:${T.sub}"><b style="font-size:11px;letter-spacing:.14em;color:${T.ink}">BLUF</b>&nbsp;&nbsp;${esc(s.summary)}</div>
${an ? `<div style="margin-top:14px;padding-left:12px;border-left:2px solid ${T.ink};font-family:${SANS};font-size:14.5px;line-height:1.55;color:${T.ink}"><span style="font-family:${MONO};font-weight:700;font-size:9.5px;letter-spacing:.14em;background:${T.ink};color:#000000;padding:3px 6px">RECON TAKE</span>&nbsp;&nbsp;${esc(an.thesis)}</div>` : ""}
<div style="margin-top:14px">${metaRight}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;background:${T.panel};border:1px solid ${T.line}"><tr><td style="padding:16px 18px">
<div>${label("Key findings")}</div>${pts.map((x) => `<div style="font-family:${SANS};font-size:14px;line-height:1.5;color:${T.sub};padding:5px 0 0 16px;text-indent:-16px"><span style="color:${T.mute}">&mdash;</span>&nbsp;${esc(x)}</div>`).join("")}
${s.why_it_matters ? `<div style="margin-top:14px">${label("Why it matters &middot; UK angle")}</div><div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${T.sub};margin-top:6px">${esc(s.why_it_matters)}</div>` : ""}
</td></tr></table>
<div style="margin-top:14px;font-family:${SANS};font-size:12.5px;line-height:1.4;color:${T.sub}"><div style="margin-bottom:8px">${label("Sources")}</div>${srcs.map((x) => `<a href="${esc(x.url)}" style="display:inline-block;color:${T.sub};text-decoration:none;border:1px solid ${T.line2};padding:3px 8px;margin:0 4px 6px 0;line-height:1.4;white-space:nowrap">${esc(x.name)}&nbsp;&#8599;</a>`).join("&#32;")}</div>
${s.read_mins && l ? `<div style="margin-top:14px"><a href="${esc(l)}" style="font-family:${SANS};font-weight:500;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${T.ink};text-decoration:none;border-bottom:1px solid ${T.mute};padding-bottom:2px">Assessment &middot; ${s.read_mins} min &rarr;</a></div>` : ""}
</td></tr></table>`;
    }
    var dateLong = () => (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    var subjectFor = (sel) => `RECON ${(/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })} \xB7 ${sel.all[0] ? sel.all[0].headline.replace(/^(DEMO REPORT|SAMPLE[A-Z :]*): ?/, "").slice(0, 70) : "UK morning brief"}`;
    function briefBody(sel, { footer = "" } = {}) {
      const mins = readMins(sel.all);
      const releases = sel.releases.length ? `${sec("&sect;3 &middot; Official releases")}${sel.releases.map(storyHTML).join("")}` : "";
      const html = min(`<div style="background:${T.bg};font-family:${SANS};color:${T.ink}">${strip()}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid ${T.line}"><tr><td style="padding:16px 20px"><span style="font-family:${SANS};font-weight:700;font-size:15px;letter-spacing:.32em;color:#ffffff">RECON</span></td><td align="right" style="padding:16px 20px">${mono(dtg())}</td></tr></table>
<div style="padding:26px 20px 8px">${label("UK morning brief")}<div style="font-family:${SANS};font-weight:600;font-size:24px;line-height:1.25;letter-spacing:-.02em;color:#ffffff;margin:10px 0 6px">${esc(dateLong())}</div><div style="font-family:${SANS};font-size:14px;line-height:1.5;color:${T.sub}">Policy rates, then the day's main reports. Tube read ${mins} min.</div>
${kpiBoard()}${sec("&sect;2 &middot; Intelligence reports")}${sel.reports.map(storyHTML).join("") || `<p style="color:${T.sub}">No corroborated stories yet today.</p>`}${releases}
<div style="padding:22px 0 20px;font-family:${SANS};font-size:12px;line-height:1.6;color:${T.mute}">AI-generated summaries of third-party reporting; may contain errors. Verify via the linked sources. General information only, not financial advice.${footer}</div></div>${strip()}</div>`);
      return { mins, html };
    }
    function render(sub, sel) {
      const unsub = sub.unsubUrl || `${BASE()}/unsubscribe?token=${sub.token}`;
      const { mins, html: body } = briefBody(sel, { footer: `<br><a href="${unsub}" style="color:${T.sub}">Unsubscribe</a>` });
      const html = `<div style="background:${T.bg};padding:0"><div style="max-width:660px;margin:0 auto">${body}</div></div>`;
      const rt = (loadRates() || { banks: [] }).banks.map((b) => `${b.code} ${b.rate}${b.unit || "%"} (${b.lastMove}; next ${b.nextLabel}; ${b.market})`).join("\n");
      const text = `RECON // UK MORNING BRIEF

POLICY RATES
${rt}

` + sel.all.map((r, i) => `${i + 1}. ${r.headline}
${r.summary}
${JSON.parse(r.sources).map((x) => x.url).join("\n")}`).join("\n\n") + `

Unsubscribe: ${unsub}`;
      return { html, text, unsub, mins };
    }
    async function sendDaily() {
      const subs = db2.prepare(`SELECT * FROM subscribers WHERE confirmed=1`).all();
      let sent = 0;
      if (process.env.RESEND_API_KEY && subs.length > 100) console.log(`[newsletter] WARNING: ${subs.length} subscribers; Resend's free plan allows 100 emails/day. Upgrade the Resend plan.`);
      for (const sub of subs) {
        const sel = storiesFor(JSON.parse(sub.topics));
        if (!sel.all.length) continue;
        const { html, text, unsub, mins } = render(sub, sel);
        try {
          await send(sub.email, subjectFor(sel), html, text, { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
          db2.prepare(`UPDATE subscribers SET last_sent_at=datetime('now') WHERE id=?`).run(sub.id);
          sent++;
        } catch (e) {
          console.log("[newsletter] failed", sub.email, e.message);
        }
        if (process.env.RESEND_API_KEY) await sleep(600);
      }
      console.log(`[newsletter] sent ${sent}/${subs.length}`);
      return sent;
    }
    async function sendTo(email) {
      const sel = storiesFor([]);
      if (!sel.all.length) return { sent: false, reason: "no stories in the last 30 hours yet" };
      const sub = { email, token: "test-send" };
      const { html, text, unsub, mins } = render(sub, sel);
      await send(email, "[TEST] " + subjectFor(sel), html, text, {});
      return { sent: true };
    }
    module2.exports = { sendConfirmation, sendDaily, sendTo, storiesFor, readMins, render, briefBody, subjectFor, kpiBoard };
  }
});

// lib/buttondown.js
var require_buttondown = __commonJS({
  "lib/buttondown.js"(exports2, module2) {
    var db2 = require_db();
    var fs = require("fs");
    var SITE = () => (process.env.SITE_URL || "").replace(/\/$/, "");
    function londonNow(now = /* @__PURE__ */ new Date()) {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
      return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
    }
    function briefDue(now = /* @__PURE__ */ new Date()) {
      const l = londonNow(now), last = db2.prepare("SELECT value FROM meta WHERE key='last_brief_day'").get();
      return l.hour >= 7 && (!last || last.value !== l.day);
    }
    var markSent = (now = /* @__PURE__ */ new Date()) => db2.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_brief_day',?)").run(londonNow(now).day);
    var nl2 = require_newsletter();
    function markdown(sel, { mins, date }) {
      const rates = (() => {
        try {
          return JSON.parse(fs.readFileSync(require_paths().RATES, "utf8"));
        } catch {
          return null;
        }
      })();
      const out = [`**${date}** \xB7 Tube read ${mins} min`];
      if (rates && rates.banks) {
        const bs = rates.banks;
        out.push(`| | ${bs.map((b) => `${b.code} ${b.rateLabel}`).join(" | ")} |
|---|${bs.map(() => "---").join("|")}|
| **Rate** | ${bs.map((b) => `**${b.rate}${b.unit || "%"}**`).join(" | ")} |
| Last | ${bs.map((b) => `${b.lastMove}: ${b.lastMoveDetail}`).join(" | ")} |
| Next | ${bs.map((b) => b.nextLabel).join(" | ")} |
| Market | ${bs.map((b) => b.market).join(" | ")} |`);
      }
      const link = (id) => SITE() ? `${SITE()}/#rpt-${id}` : "";
      sel.all.forEach((r, i) => {
        const an = r.analysis ? JSON.parse(r.analysis) : null, srcs = JSON.parse(r.sources), pts = JSON.parse(r.key_points);
        out.push(`### ${i + 1}. ${r.headline}
*${r.kind === "RELEASE" ? "Official release" : `${r.topic} \xB7 ${r.source_count} sources \xB7 confidence ${r.confidence}`}*

**BLUF** ${r.summary}` + (an ? `

> **RECON take:** ${an.thesis}` : "") + `

${pts.map((x) => `- ${x}`).join("\n")}` + (r.why_it_matters ? `

**UK angle:** ${r.why_it_matters}` : "") + (r.read_mins && link(r.id) ? `

[Full assessment \xB7 ${r.read_mins} min read](${link(r.id)})` : "") + `

Sources: ${srcs.map((x) => `[${x.name}](${x.url})`).join(" \xB7 ")}`);
      });
      out.push("---\n*AI-generated summaries of reporting by third-party outlets; verify via the linked sources. General information, not financial advice.*");
      return out.join("\n\n");
    }
    function body(sel, extra) {
      const { mins, html } = nl2.briefBody(sel);
      if (process.env.BRIEF_FORMAT === "markdown") return markdown(sel, { mins, date: extra.date });
      return html;
    }
    async function publish(sel, extra) {
      if (!process.env.BUTTONDOWN_API_KEY) throw new Error("BUTTONDOWN_API_KEY not set");
      const subject = nl2.subjectFor(sel);
      const res = await fetch("https://api.buttondown.email/v1/emails", {
        method: "POST",
        headers: { Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: body(sel, extra), status: process.env.BUTTONDOWN_AUTOSEND === "1" ? "about_to_send" : "draft" })
      });
      if (!res.ok) throw new Error(`Buttondown ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { subject, mode: process.env.BUTTONDOWN_AUTOSEND === "1" ? "sent" : "draft" };
    }
    module2.exports = { briefDue, markSent, markdown, body, publish, londonNow };
  }
});

// lib/resend.js
var require_resend = __commonJS({
  "lib/resend.js"(exports2, module2) {
    var nl2 = require_newsletter();
    async function call(method, path, body) {
      const r = await fetch("https://api.resend.com" + path, { method, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : void 0 });
      const text = await r.text();
      let j = {};
      try {
        j = JSON.parse(text);
      } catch {
      }
      if (!r.ok) throw new Error(`Resend ${method} ${path} -> ${r.status}: ${text.slice(0, 250)}`);
      return j;
    }
    async function publish(sel, extra) {
      if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
      const list = process.env.RESEND_SEGMENT_ID ? { segment_id: process.env.RESEND_SEGMENT_ID } : process.env.RESEND_AUDIENCE_ID ? { audience_id: process.env.RESEND_AUDIENCE_ID } : null;
      if (!list) throw new Error("set RESEND_SEGMENT_ID or RESEND_AUDIENCE_ID");
      const { html, text, mins } = nl2.render({ email: "broadcast", unsubUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}" }, sel);
      const subject = nl2.subjectFor(sel);
      const b = await call("POST", "/broadcasts", { ...list, from: process.env.MAIL_FROM, subject, name: `RECON ${extra.date}`, html, text: text.replace(/Unsubscribe: .*/, "Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}") });
      if (process.env.RESEND_AUTOSEND !== "1") return { mode: "draft", subject, id: b.id };
      await call("POST", `/broadcasts/${b.id}/send`, {});
      return { mode: "sent", subject, id: b.id };
    }
    module2.exports = { publish };
  }
});

// lib/api.js
var require_api = __commonJS({
  "lib/api.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var db2 = require_db();
    var { TOPICS } = require_sources();
    function storiesPayload(topic) {
      const since = new Date(Date.now() - 72 * 36e5).toISOString().replace("T", " ").slice(0, 19);
      let rows = db2.prepare(`SELECT * FROM stories WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 60`).all(since);
      if (topic && TOPICS.includes(topic)) rows = rows.filter((r) => r.topic === topic);
      const events = {};
      try {
        (JSON.parse(fs.readFileSync(require_files().find("calendar.json"), "utf8")).events || []).forEach((e) => {
          events[e.id] = { date: e.date, label: e.label };
        });
      } catch {
      }
      return { topics: TOPICS, events, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stories: rows.map((r) => {
        return {
          id: r.id,
          topic: r.topic,
          headline: r.headline,
          summary: r.summary,
          keyPoints: JSON.parse(r.key_points),
          whyItMatters: r.why_it_matters,
          disagreements: JSON.parse(r.disagreements || "[]"),
          confidence: r.confidence,
          sources: JSON.parse(r.sources),
          sourceCount: r.source_count,
          updatedAt: r.updated_at + "Z",
          kind: r.kind || "REPORT",
          assessment: r.assessment ? JSON.parse(r.assessment) : null,
          analysis: r.analysis ? JSON.parse(r.analysis) : null,
          readMins: r.read_mins || null
        };
      }) };
    }
    var ratesPayload2 = () => JSON.parse(fs.readFileSync(require_paths().RATES, "utf8"));
    module2.exports = { storiesPayload, ratesPayload: ratesPayload2 };
  }
});

// lib/poll.js
var require_poll = __commonJS({
  "lib/poll.js"(exports2, module2) {
    var crypto = require("crypto");
    var db2 = require_db();
    var llm = require_llm();
    var nl2 = require_newsletter();
    var { allPresent } = require_verify();
    var { londonNow } = require_buttondown();
    var SYSTEM = `You write the daily reader poll for RECON, a UK economics, banking and markets briefing for finance professionals.
From the stories provided, write ONE neutral yes/no question readers can answer with an opinion or expectation (not a fact lookup).
Rules: at most 110 characters; ends with a question mark; neutral wording (never leading or loaded); about exactly ONE of the stories; plain language; no personal data; do not state any number, date or name that is not in the story text; no investment advice.
Return ONLY JSON: {"question":"...","story_id":<id from the list>}`;
    var bad = (q, ctx, ids, j) => !q || q.length > 140 || !/\?$/.test(q) || !ids.includes(+j.story_id) || !allPresent(q, ctx);
    async function ensureDailyPoll(now = /* @__PURE__ */ new Date()) {
      const l = londonNow(now);
      if (l.hour < 6) return null;
      if (db2.prepare("SELECT 1 FROM polls WHERE id=?").get(l.day)) return null;
      const sel = nl2.storiesFor([]);
      if (!sel.all.length) return null;
      const ctx = sel.all.map((s) => `[${s.id}] ${s.headline}. ${s.summary}`).join("\n"), ids = sel.all.map((s) => s.id);
      const prev = db2.prepare("SELECT question FROM polls ORDER BY id DESC LIMIT 1").get();
      let q = null, sid = null, source = "ai";
      if (process.env.DEMO !== "1" && llm.configured()) {
        try {
          const j = await llm.json(SYSTEM, ctx, { max: 300 });
          const cand = String(j && j.question || "").trim();
          if (!bad(cand, ctx, ids, j) && (!prev || prev.question !== cand)) {
            q = cand;
            sid = +j.story_id;
          } else console.log("[poll] AI question rejected:", cand.slice(0, 90));
        } catch (e) {
          console.log("[poll] AI failed:", e.message);
        }
      }
      if (!q) {
        const top = sel.all.map((s) => ({ s, an: s.analysis ? JSON.parse(s.analysis) : null })).find((x) => x.an && x.an.thesis);
        if (!top) return null;
        let t = top.an.thesis.split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "");
        if (t.length > 90) t = t.slice(0, 88).replace(/\s\S*$/, "") + "\u2026";
        q = `Do you agree with RECON's take: "${t}"?`;
        sid = top.s.id;
        source = "fallback";
      }
      db2.prepare("INSERT OR IGNORE INTO polls (id, question, story_id, source) VALUES (?,?,?,?)").run(l.day, q, sid, source);
      console.log(`[poll] ${l.day} (${source}): ${q}`);
      return { id: l.day, question: q, storyId: sid };
    }
    function pollPayload(now = /* @__PURE__ */ new Date()) {
      const l = londonNow(now), y = londonNow(new Date(now - 864e5));
      const p = db2.prepare("SELECT * FROM polls WHERE id IN (?,?) ORDER BY id DESC LIMIT 1").get(l.day, y.day);
      return { poll: p ? { id: p.id, question: p.question, storyId: p.story_id, createdAt: p.created_at } : null };
    }
    var counts = (id) => {
      const r = db2.prepare("SELECT choice, COUNT(*) c FROM poll_votes WHERE poll_id=? GROUP BY choice").all(id);
      const o = { yes: 0, no: 0 };
      r.forEach((x) => {
        o[x.choice] = x.c;
      });
      return o;
    };
    function vote(id, ip, choice) {
      if (!["yes", "no"].includes(choice)) return { status: 400 };
      if (!db2.prepare("SELECT 1 FROM polls WHERE id=?").get(id)) return { status: 404 };
      const voter = crypto.createHash("sha256").update(`${ip}|${id}|${process.env.POLL_SALT || "recon"}`).digest("hex").slice(0, 32);
      const r = db2.prepare("INSERT OR IGNORE INTO poll_votes (poll_id, voter, choice) VALUES (?,?,?)").run(id, voter, choice);
      return { status: r.changes ? 200 : 409, results: counts(id) };
    }
    module2.exports = { ensureDailyPoll, pollPayload, counts, vote };
  }
});

// lib/rates-official.js
var require_rates_official = __commonJS({
  "lib/rates-official.js"(exports2, module2) {
    var fs = require("fs");
    var UA = "Mozilla/5.0 (compatible; ReconBot/1.0; +official data)";
    var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    var MONF = (m) => MON.findIndex((x) => x === String(m).slice(0, 3).toUpperCase());
    var d2 = (n) => String(n).padStart(2, "0");
    var human = (iso) => {
      const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
      return `${d.getUTCDate()} ${MON[d.getUTCMonth()][0] + MON[d.getUTCMonth()].slice(1).toLowerCase()} ${d.getUTCFullYear()}`;
    };
    function csvRows(text) {
      const rows = [];
      let row = [], cur = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
          if (c === '"') {
            if (text[i + 1] === '"') {
              cur += '"';
              i++;
            } else q = false;
          } else cur += c;
        } else if (c === '"') q = true;
        else if (c === ",") {
          row.push(cur);
          cur = "";
        } else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(cur);
          if (row.some((x) => x.trim() !== "")) rows.push(row);
          row = [];
          cur = "";
        } else cur += c;
      }
      row.push(cur);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      return rows;
    }
    var isoOf = (s) => {
      s = String(s).trim();
      let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = /^(\d{1,2})[ \/-]([A-Za-z]{3})[a-z]*[ \/-](\d{4})$/.exec(s);
      if (m && MONF(m[2]) >= 0) return `${m[3]}-${d2(MONF(m[2]) + 1)}-${d2(m[1])}`;
      return null;
    };
    function series(text, dateCol, valueCol) {
      const rows = csvRows(text);
      if (rows.length < 2) return [];
      const head = rows[0].map((h) => h.trim().replace(/^﻿/, "").toLowerCase());
      const di = dateCol ? head.indexOf(dateCol) : 0, vi = valueCol ? head.indexOf(valueCol) : 1;
      if (di < 0 || vi < 0) throw new Error("unexpected CSV columns: " + head.join("|").slice(0, 80));
      return rows.slice(1).map((r) => ({ date: isoOf(r[di]), value: parseFloat(r[vi]) })).filter((x) => x.date && Number.isFinite(x.value)).sort((a, b) => a.date.localeCompare(b.date));
    }
    function lastChange(s) {
      const last = s[s.length - 1];
      let from = null;
      for (let i = s.length - 1; i > 0; i--) if (Math.abs(s[i].value - s[i - 1].value) > 1e-4) {
        from = { date: s[i].date, bp: Math.round((s[i].value - s[i - 1].value) * 100) };
        break;
      }
      return { last, change: from };
    }
    var pct = (v) => v.toFixed(2);
    function describe(ch, since) {
      const { last, change } = ch, days = change ? (Date.now() - new Date(change.date)) / 864e5 : 9e9;
      if (!change) return { lastMove: "HOLD", lastMoveDetail: "Unchanged for over two years" };
      const dir = change.bp > 0 ? "HIKE" : "CUT", recent = days <= 45;
      return { lastMove: recent ? dir : "HOLD", lastMoveDetail: recent ? `${dir === "HIKE" ? "+" : ""}${change.bp}bp to ${pct(last.value)}% on ${human(change.date)}` : `Unchanged since ${human(change.date)} (${change.bp > 0 ? "+" : ""}${change.bp}bp)` };
    }
    var fmtDate = (d) => `${d2(d.getUTCDate())}/${MON[d.getUTCMonth()][0] + MON[d.getUTCMonth()].slice(1).toLowerCase()}/${d.getUTCFullYear()}`;
    var SOURCES = {
      BOE: {
        url: () => `https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp?csv.x=yes&Datefrom=${fmtDate(new Date(Date.now() - 800 * 864e5))}&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`,
        parse(text) {
          const s = series(text);
          if (!s.length) throw new Error("no Bank Rate observations");
          const c = lastChange(s);
          return { rateNum: c.last.value, rate: pct(c.last.value), asAt: c.last.date, ...describe(c), sub: "" };
        }
      },
      ECB: {
        url: (s) => `https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.${s}.LEV?startPeriod=${new Date(Date.now() - 800 * 864e5).toISOString().slice(0, 10)}&format=csvdata`,
        series: ["DFR", "MRR_FR", "MLFR"],
        parse(texts) {
          const [dfr, mro, mlf] = texts.map((t, i) => {
            if (!t && i) return null;
            const s = series(t, "time_period", "obs_value");
            if (!s.length && !i) throw new Error("no ECB observations");
            return s;
          });
          const c = lastChange(dfr), l = (x) => x && x.length ? pct(x[x.length - 1].value) : null;
          return { rateNum: c.last.value, rate: pct(c.last.value), asAt: c.last.date, ...describe(c), sub: [l(mro) && `MRO ${l(mro)}%`, l(mlf) && `MLF ${l(mlf)}%`].filter(Boolean).join(" \xB7 ") };
        }
      },
      FED: {
        url: (id) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${new Date(Date.now() - 800 * 864e5).toISOString().slice(0, 10)}`,
        series: ["DFEDTARU", "DFEDTARL", "IORB"],
        parse(texts) {
          const [up, lo, iorb] = texts.map((t, i) => {
            if (!t && i > 1) return null;
            const s = series(t);
            if (!s.length && i < 2) throw new Error("no FRED observations");
            return s;
          });
          const U = lastChange(up), L = lastChange(lo), ior = iorb && iorb.length ? pct(iorb[iorb.length - 1].value) : null;
          return { rateNum: U.last.value, rate: `${pct(L.last.value)}\u2013${pct(U.last.value)}`, asAt: U.last.date, ...describe(U), sub: ior ? `IORB ${ior}%` : "" };
        }
      }
    };
    async function getText(url, fetchFn) {
      const r = await fetchFn(url, { headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25e3) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const t = await r.text();
      if (/^\s*<(!doctype|html)/i.test(t)) throw new Error("blocked (HTML returned)");
      return t;
    }
    function nextMeeting(code, now) {
      let cal = [];
      try {
        cal = JSON.parse(fs.readFileSync(require_files().find("calendar.json"), "utf8")).events || [];
      } catch {
      }
      const e = cal.filter((x) => x.id.startsWith(code.toLowerCase() + "-") && new Date(x.date) > now).sort((a, b) => a.date.localeCompare(b.date))[0];
      return e ? { next: e.date, nextLabel: `${d2(new Date(e.date).getUTCDate())} ${MON[new Date(e.date).getUTCMonth()]}` } : null;
    }
    async function refresh({ fetchFn = fetch, file = require_paths().RATES, now = /* @__PURE__ */ new Date() } = {}) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")), results = {};
      for (const bank of data.banks) {
        const src = SOURCES[bank.code];
        if (!src) continue;
        try {
          const got = src.series ? await Promise.all(src.series.map((s, i) => getText(src.url(s), fetchFn).catch((e) => {
            if (i === 0 || bank.code === "FED" && i === 1) throw e;
            return "";
          }))) : await getText(src.url(), fetchFn);
          const p = src.parse(got);
          const changed = bank.rateNum != null && Math.abs(p.rateNum - bank.rateNum) > 1e-3;
          Object.assign(bank, { rate: p.rate, rateNum: p.rateNum, sub: p.sub, lastMove: p.lastMove, lastMoveDetail: p.lastMoveDetail, officialAt: now.toISOString(), officialAsAt: p.asAt, stale: false });
          const nm = nextMeeting(bank.code, now);
          if (nm) Object.assign(bank, nm);
          else if (new Date(bank.next) < now) {
            bank.next = "";
            bank.nextLabel = "TBC";
          }
          if (changed) {
            delete bank.market;
            delete bank.marketProb;
          }
          results[bank.code] = { ok: true, rate: p.rate, asAt: p.asAt };
        } catch (e) {
          const age = bank.officialAt ? (now - new Date(bank.officialAt)) / 36e5 : 1e9;
          if (age > 36) bank.stale = true;
          results[bank.code] = { ok: false, error: String(e.message).slice(0, 140) };
        }
      }
      if (Object.values(results).some((r) => r.ok)) data.asOf = now.toISOString().slice(0, 10);
      data.note = "Rates auto-updated every run from official sources (BoE IADB, ECB Data Portal, FRED/Federal Reserve). Next-meeting dates come from calendar.json; market pricing from rateprobability.com when available.";
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
      console.log("[rates-official]", JSON.stringify(results));
      return results;
    }
    module2.exports = { refresh, series, lastChange, csvRows, SOURCES, isoOf };
    if (require.main === module2) {
      require("dotenv").config();
      refresh().then(() => process.exit(0));
    }
  }
});

// scripts/build-site.js
var require_build_site = __commonJS({
  "scripts/build-site.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    function build(out = process.env.OUT_DIR || "dist") {
      const { storiesPayload, ratesPayload: ratesPayload2 } = require_api();
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(path.join(out, "data"), { recursive: true });
      const w = (f, o) => fs.writeFileSync(path.join(out, "data", f), JSON.stringify(o));
      w("stories.json", storiesPayload());
      w("rates.json", ratesPayload2());
      w("poll.json", require_poll().pollPayload());
      let h = fs.readFileSync(require_files().find("index.html"), "utf8");
      const sub = (a, b) => {
        if (!(a.test ? a.test(h) : h.includes(a))) throw new Error("static build: pattern not found: " + String(a).slice(0, 60));
        h = h.replace(a, b);
      };
      const cfg = { stories: "data/stories.json", rates: "data/rates.json", poll: "data/poll.json", vote: (process.env.POLL_API || "").replace(/\/+$/, "") };
      sub(/const STORIES_URL='[^']*',RATES_URL='[^']*',POLLQ='[^']*',VOTE_BASE='[^']*';/, `const STORIES_URL=${JSON.stringify(cfg.stories)},RATES_URL=${JSON.stringify(cfg.rates)},POLLQ=${JSON.stringify(cfg.poll)},VOTE_BASE=${JSON.stringify(cfg.vote)};`);
      sub("register('/sw.js')", "register('./sw.js')");
      sub("Double opt-in. Unsubscribe in one click. Your selected area of operations sets your sectors.", "Double opt-in. Unsubscribe in one click.");
      const action = process.env.SUBSCRIBE_FORM_ACTION || "";
      const mm = /embed-subscribe\/([^/?#]+)/.exec(action), direct_link = mm ? "https://buttondown.com/" + mm[1] : "";
      const mode = process.env.SUBSCRIBE_MODE || "form";
      const post = action && mode === "worker" ? `const em=$('#em').value;if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em))throw new Error('Invalid email address.');const r=await fetch(${JSON.stringify(action)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Could not subscribe. Please try again later.');` : action ? `const em=$('#em').value;if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em))throw new Error('Invalid email address.');const fm=document.createElement('form');fm.method='POST';fm.action=${JSON.stringify(action)};fm.target='_blank';fm.style.display='none';for(const [k,v] of [['email',em],['embed','1']]){const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;fm.appendChild(i)}document.body.appendChild(fm);fm.submit();fm.remove();m.textContent='Confirmation page opened in a new tab: finish there, then check your inbox and spam folder.';${JSON.stringify(direct_link)}&&m.insertAdjacentHTML('beforeend',' <a href="${direct_link}" target="_blank" rel="noopener">Page blocked? Subscribe here.</a>');$('#em').value='';SFX.ok();b.disabled=false;return;` : `throw new Error('Sign-ups open soon.');`;
      sub(/const r=await fetch\('\/api\/subscribe'[^\n]*\n\s*const j=await r.json\(\);if\(!r.ok\)throw new Error\(j.error\|\|'Failed'\);/, post);
      sub("m.textContent='Check your inbox to confirm.'", "m.textContent='Check your inbox to confirm (and your spam folder).'");
      if (!action) console.log('[site] WARNING: SUBSCRIBE_FORM_ACTION not set: the sign-up box will say "Sign-ups open soon".');
      fs.writeFileSync(path.join(out, "index.html"), h);
      fs.copyFileSync(require_files().find("sw.js"), path.join(out, "sw.js"));
      try {
        const db2 = require_db(), r = db2.prepare("SELECT value FROM meta WHERE key='status'").get(), st = r ? JSON.parse(r.value) : null;
        const e = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        const rows = st ? [...st.feeds].sort((a, b) => a.ok - b.ok || a.name.localeCompare(b.name)).map((f) => `<tr><td>${f.ok ? "OK" : "<b>FAIL</b>"}</td><td>${e(f.name)}</td><td>${f.items}</td><td>${e(f.error || f.note || "")}</td></tr>`).join("") : "";
        const by = st ? Object.entries(st.articlesBySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${e(k)} ${v}`).join(" \xB7 ") : "";
        fs.writeFileSync(path.join(out, "status.html"), `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>RECON status</title><style>body{background:#000;color:#ccc;font:13px ui-monospace,monospace;padding:24px;max-width:1100px;margin:auto}td,th{padding:4px 12px 4px 0;text-align:left;vertical-align:top}b{color:#fff}h1{font-size:15px;color:#fff}</style><h1>RECON \xB7 pipeline status</h1>${st ? `<p>Last run ${e(st.at)}<br>Looked back ${st.windowHours}h \xB7 ${st.articles} articles \xB7 ${st.clusters} corroborated stories (sizes ${st.clusterSizes.join(", ") || "none"}) \xB7 similarity ${st.similarity}</p><p>Articles per outlet: ${by || "none"}</p><table><tr><th>State<th>Feed<th>Items kept<th>Note</tr>${rows}</table>` : "<p>No run recorded yet.</p>"}`);
      } catch (err) {
        console.log("[site] status page skipped:", err.message);
      }
      fs.writeFileSync(path.join(out, ".nojekyll"), "");
      fs.writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
      console.log(`[site] built ${out}/ (${storiesPayload().stories.length} stories)`);
    }
    module2.exports = { build };
    if (require.main === module2) {
      require("dotenv").config();
      build();
    }
  }
});

// scripts/run-once.js
require("dotenv").config();
for (const k of ["RECON_VARS", "RECON_SECRETS"]) {
  try {
    for (const [n, v] of Object.entries(JSON.parse(process.env[k] || "{}"))) if (n.toLowerCase() !== "github_token" && v !== "" && v != null && process.env[n] === void 0) process.env[n] = String(v);
  } catch {
  }
}
var db = require_db();
var pipeline = require_pipeline();
var rateprob = require_rateprobability();
var nl = require_newsletter();
var bd = require_buttondown();
var rsd = require_resend();
var { ratesPayload } = require_api();
var poll = require_poll();
var official = require_rates_official();
var meta = (k) => (db.prepare("SELECT value FROM meta WHERE key=?").get(k) || {}).value;
var setMeta = (k, v) => db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)").run(k, String(v));
(async () => {
  await official.refresh().catch((e) => console.log("[rates-official] failed:", e.message));
  if (process.env.SKIP_RATES !== "1" && (!meta("last_rates_at") || Date.now() - +meta("last_rates_at") > 10 * 36e5)) {
    await rateprob.refresh().catch((e) => console.log("[rates] failed:", e.message));
    setMeta("last_rates_at", Date.now());
  }
  await pipeline().catch((e) => console.log("[pipeline] failed:", e.message));
  await poll.ensureDailyPoll().catch((e) => console.log("[poll] failed:", e.message));
  if (["buttondown", "resend"].includes(process.env.NEWSLETTER_PROVIDER) && bd.briefDue()) {
    const sel = nl.storiesFor([]);
    if (sel.all.length) {
      try {
        const rates = ratesPayload().banks.map((b) => `${b.code} ${b.rate}${b.unit || "%"}`).join(" \xB7 ");
        const info = await (process.env.NEWSLETTER_PROVIDER === "resend" ? rsd : bd).publish(sel, { mins: nl.readMins(sel.all), rates, date: (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) });
        bd.markSent();
        console.log(`[brief] ${info.mode}: ${info.subject}`);
      } catch (e) {
        console.log("[brief] FAILED:", e.message);
      }
    } else console.log("[brief] nothing to send yet");
  }
  require_build_site().build();
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = db.prepare("SELECT name,tier,required,last_ok,items,last_error FROM source_health ORDER BY required DESC, (last_ok IS NULL) DESC, name").all();
    const use = db.prepare("SELECT * FROM llm_usage ORDER BY day DESC LIMIT 3").all();
    const c = (q) => db.prepare(q).get().c;
    const md = [
      `## RECON run summary`,
      `Reports (24h): **${c("SELECT COUNT(*) c FROM stories WHERE kind!='RELEASE' AND updated_at >= datetime('now','-24 hours')")}** \xB7 Official releases (24h): **${c("SELECT COUNT(*) c FROM stories WHERE kind='RELEASE' AND updated_at >= datetime('now','-24 hours')")}** \xB7 Articles fetched (24h): **${c("SELECT COUNT(*) c FROM articles WHERE fetched_at >= datetime('now','-24 hours')")}**`,
      `
### AI usage
| Day | Calls | Tokens in | Tokens out |
|---|---|---|---|`,
      ...use.map((u) => `| ${u.day} | ${u.calls} | ${u.input_tokens} | ${u.output_tokens} |`),
      `
### Sources (required first; problems at the top)
| Source | Tier | Last OK | Items | Problem |
|---|---|---|---|---|`,
      ...rows.map((r) => `| ${r.name}${r.required ? " *" : ""} | ${r.tier} | ${r.last_ok ? r.last_ok.slice(0, 16) : "**never**"} | ${r.items} | ${(r.last_error || "").replace(/\|/g, "/").slice(0, 80)} |`)
    ].join("\n");
    require("fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  process.exit(0);
})();
