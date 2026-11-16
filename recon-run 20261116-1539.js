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
        MAX_LLM_CALLS_PER_DAY: "120",
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
    module2.exports.FINANCE_RE = /\b(econom\w*|inflation|interest rates?|central bank|fed|federal reserve|bank of england|ecb|gdp|recession|tariffs?|trade|markets?|stocks?|shares|bonds?|gilts?|yields?|oil|currency|sterling|dollar|euro|mortgages?|housing|jobs|unemployment|wages?|budget|tax|debt|banks?|banking|earnings|ipo|merger|crypto|bitcoin|ftse|lender|insurer|results|profits?|spending|borrowing|fiscal|monetary|growth|stamp duty|pension|savings|dividends?|buybacks?|profit warnings?|equit(y|ies)|stock markets?|share price|sell-?off|rall(y|ies)|nasdaq|dow jones|stoxx|dax|nikkei|hang seng|trading update|listing)\b/i;
    module2.exports.UK_RE = /\b(uk|u\.k\.|britain|british|england|london|scotland|wales|sterling|gilts?|ftse|bank of england|boe|bailey|mpc|labour|chancellor|reeves|ons|hmrc|fca|pra|barclays|lloyds|hsbc|natwest|nationwide|santander uk|standard chartered|london stock exchange|city of london|autumn budget|stamp duty|isa)\b/i;
    module2.exports.DRIVERS_RE = /\b(federal reserve|fed|fomc|ecb|tariffs?|brent|opec|treasury yields|wall street|s&p 500|nasdaq|strait of hormuz|stock markets?|global (stocks|shares|equities)|dow jones|stoxx|dax|nikkei|hang seng|earnings season)\b/i;
    module2.exports.TOPICS = ["RATES & BOE", "UK ECONOMY", "BANKING", "MARKETS", "STOCKS", "PROPERTY", "FISCAL", "ENERGY & TRADE"];
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
    var MIN_SOURCES = +(process.env.MIN_SOURCES || 2);
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
    function cluster(arts, th = THRESHOLD, min = MIN_SOURCES) {
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
      }).filter((g) => g.length >= min).map((g) => ({ articles: g, key: crypto.createHash("sha1").update(g.map((a) => a.url).sort()[0]).digest("hex").slice(0, 16) })).sort((a, b) => b.articles.length - a.articles.length);
    }
    function clusterAdaptive(arts, target = +(process.env.MIN_STORIES_TARGET || 4)) {
      let best = { clusters: [], th: THRESHOLD };
      for (const th of [THRESHOLD, 0.23]) {
        const c = cluster(arts, th);
        if (c.length > best.clusters.length || th === THRESHOLD) best = { clusters: c, th };
        if (c.length >= target) break;
      }
      return best;
    }
    function twoSource(arts, th, taken) {
      const used = new Set(taken.flatMap((c) => c.articles.map((a) => a.url)));
      return cluster(arts.filter((a) => !used.has(a.url)), th, 2).filter((c) => c.articles.length === 2).map((c) => ({ ...c, provisional: true }));
    }
    module2.exports = { cluster, clusterAdaptive, twoSource, MIN_SOURCES };
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
      const call = (o) => p === "anthropic" ? anthropicJSON(system, user, o) : openaiJSON(system, user, o);
      if (p === "anthropic" || p === "openai") {
        try {
          return await call(opts);
        } catch (e) {
          if (/truncated/.test(e.message) && opts.max) return call({ ...opts, max: Math.min(opts.max * 2, 16e3) });
          throw e;
        }
      }
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
      const count = () => [...out.situation, ...out.background, ...out.market_reaction, ...out.compare, ...out.watch.map((w) => w.what), ...out.numbers.map((n) => `${n.label} ${n.value} ${n.context}`)].join(" ").split(/\s+/).filter(Boolean).length;
      const MAXW = +(process.env.MAX_ASSESSMENT_WORDS || 600);
      const trims = [
        () => out.background.length > 1 && out.background.pop(),
        () => out.compare.length > 1 && out.compare.pop(),
        () => out.market_reaction.length > 1 && out.market_reaction.pop(),
        () => out.numbers.length > 6 && out.numbers.pop(),
        () => out.watch.length > 2 && out.watch.pop(),
        () => out.background.length && out.background.pop(),
        () => out.compare.length && out.compare.pop(),
        () => out.situation.length > 2 && out.situation.pop(),
        () => out.numbers.length > 3 && out.numbers.pop(),
        () => out.market_reaction.length && out.market_reaction.pop()
      ];
      for (const t of trims) {
        while (count() > MAXW && t()) {
          stats.trimmed = (stats.trimmed || 0) + 1;
        }
        if (count() <= MAXW) break;
      }
      const words = count();
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
      const MAXA = +(process.env.MAX_ANALYSIS_WORDS || 380), wc = () => [out.thesis, ...out.body, out.counter].join(" ").split(/\s+/).filter(Boolean).length;
      while (wc() > MAXA && out.body.length > 1) out.body.pop();
      out.words = wc();
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
You receive 2+ items from different sources, supposedly about the SAME event, numbered [1], [2], ...
Source policy: items marked PRIMARY include full text of a public/primary source and are the basis for all detail. Items marked CORROBORATION are third-party outlets for which we hold only a headline and a short feed description: use them only to corroborate facts and to note agreement or differences, never copy their wording, and never use them to add detail that no PRIMARY item contains.
Write ONE corroborated report using ONLY facts stated in the articles.

Hard rules:
- If the articles are NOT about the same event, or fewer than 2 outlets clearly corroborate it, return {"same_event": false}.
- Every number, date, name, vote count and quote-like claim must appear in the provided text. NEVER compute derived figures (differences, percentage changes, averages) and never estimate or round differently. If a figure is not in the text, leave it out.
- Attribute with inline source markers, e.g. "... voted 6-3 to hold [1][3]". Put them at the end of the sentence.
- Do not copy phrasing from the articles; paraphrase. No direct quotes.
- Where outlets differ on a fact or framing, say so in "compare" and name the outlets by marker.
- No speculation, no opinion, no advice here. (Opinion lives in a separate step.)
- Depth: HARD LIMIT 550 words across all assessment sections together (a 3-minute read). Aim for 400-550 when the sources hold that much detail; be dense and cut anything non-essential. Never pad. If the sources are thin, write less.
- Topic must be one of: ${TOPICS.join(" | ")}. STOCKS = equity markets (FTSE indices, Wall Street, individual listed companies: results, profit warnings, dividends, buybacks, M&A, IPOs, analyst moves). MARKETS = gilts, sterling and other FX, commodities, credit.
- uk_relevance: 5 = about the UK economy, UK banks, FTSE or FTSE-listed companies or the Bank of England; 3 = overseas event with a UK impact stated in the articles; 1-2 = no real UK angle.
- confidence: HIGH = three or more sources agree on the core facts (with only two sources, never above MEDIUM); MEDIUM = minor differences; LOW = material conflict or thin detail.

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
      const json = await llm.json(SYSTEM + (brief ? BRIEF_NOTE : ""), body, { max: brief ? 2500 : 6e3 });
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
- Take a clear view in one sentence (the thesis). Then 2-4 short paragraphs of reasoning (250-330 words total: a 1.5 to 2 minute read; hard limit 350 words including the counter-case) that connect this report to other recent reports and/or upcoming events where the link is genuine. If nothing genuinely connects, say so; never force a link.
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
      const raw = await llm.json(SYSTEM, prompt, { max: 2e3, model: process.env.ANALYSIS_MODEL });
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
    var NOISE = /\b(administration|administrators?|insolven\w*|liquidat\w*|winding[- ]up|final notice|fined?|fines|warning list|clone firm|scam|overseas pension|qrops|rops|self assessment|guidance for|how to|help with|campaign|apprentice\w*|consultation (outcome|response)|call for input|webinar|appointment of|board member|annual report and accounts|freedom of information|transparency data|spending over|corporate (plan|report)|diversity|research (note|paper)|enforcement|prohibition|ban(s|ned)? |ltd|limited|plc|llp|wind[- ]down|suspend\w*|restrictions? on|charged|convicted|jailed|sentenced|court|tribunal|dispute|mis-?selling|complaints data|reminder|deadline|pension schemes?|scheme members?|trust(ee)?s?|charit\w+|fraud\w*|money laundering|sanctions? list|authori[sz]ation|permission|register)\b/i;
    var MOVER = /\b(interest rates?|bank rate|inflation|cpi|gdp|growth|unemployment|labour market|wages?|budget|spring statement|autumn statement|fiscal|gilts?|borrowing|tax (rise|cut|rates?|changes?)|stamp duty|capital gains|inheritance tax|national insurance|income tax|corporation tax|vat|mortgage\w*|bank(s|ing)? (capital|rules|ring-?fenc\w*)|capital requirements?|stress test|ring-?fenc\w*|consumer duty|motor finance|redress|merger|takeover|competition (probe|investigation)|market study|price cap|energy price|ofgem|pensions? (reform|review)|financial stability|systemic|stablecoin)\b/i;
    var STRICT = /* @__PURE__ */ new Set(["FCA", "HMRC", "CMA"]);
    var PRIORITY = ["ONS", "OBR", "Bank of England", "HM Treasury", "FCA", "HMRC", "CMA", "Federal Reserve", "ECB"];
    var PER_SOURCE = +(process.env.RELEASES_PER_SOURCE || 2);
    var MAX = +(process.env.MAX_RELEASES || 6);
    var WINDOW_H = +(process.env.RELEASE_WINDOW_HOURS || 48);
    var SYSTEM = `You are the analyst desk of RECON, a UK-focused economics, banking and markets briefing for finance professionals (intermediate to expert: no basics, give the detail and the numbers).
You receive ONE official publication (full text) from a primary source: a statistics release, fiscal forecast, central-bank statement, regulator notice or Treasury publication.
Write a report on it using ONLY facts stated in that text.

Hard rules:
- Every number, date and name must appear in the provided text. NEVER compute derived figures (changes, averages, percentages) or round differently. If a figure is not in the text, leave it out.
- Paraphrase; no direct quotes; add inline marker [1] at the end of sentences (there is a single source).
- No speculation, opinion or advice here (opinion lives in a separate step).
- Depth: HARD LIMIT 550 words across all assessment sections (a 3-minute read); roughly 250-550 depending on the document. Be dense. Never pad.
- MATERIALITY: readers are bankers and investors who want news that moves rates, markets, bank earnings, tax or regulation across the sector. Return {"skip":true} for anything routine or narrow: individual firms or people, insolvencies, enforcement or fines, pension-scheme admin, guidance, consultations without a decision, speeches without new policy, or anything with no UK relevance (uk_relevance < 3 and not a Fed/ECB item that matters to UK rates). When in doubt, skip.
- topic must be one of: ${TOPICS.join(" | ")}.
Return ONLY JSON:
{"skip":false,"uk_relevance":1-5,"topic":"...","headline":"<=80 chars, plain statement of the news","summary":"<=50 words, bottom line up front","key_points":["3-4 bullets <=14 words"],"why_it_matters":"<=35 words, the UK angle","assessment":{"situation":["1-3 paragraphs: what was published, the headline figures, what changed"],"numbers":[{"label":"...","value":"exactly as written","source":1,"context":"<=14 words"}],"background":["0-2 paragraphs of context from the document"],"market_reaction":[],"compare":[],"watch":[{"when":"date as written","what":"next step, release or decision mentioned in the document"}]}}
Up to 10 rows in "numbers", most decision-relevant first.`;
    var hash = (u) => "rel-" + crypto.createHash("sha1").update(u).digest("hex").slice(0, 16);
    async function runReleases() {
      if (process.env.DEMO === "1" || !llm.configured()) return 0;
      for (const r of db2.prepare("SELECT id, sources FROM stories WHERE kind='RELEASE'").all()) {
        try {
          const x = JSON.parse(r.sources)[0];
          if (NOISE.test(x.title) || STRICT.has(x.name) && !MOVER.test(x.title)) db2.prepare("DELETE FROM stories WHERE id=?").run(r.id);
        } catch {
        }
      }
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
        if (NOISE.test(a.title) || STRICT.has(a.source) && !MOVER.test(a.title)) {
          if (!seen.get(a.url)) mark(a.url, "not-material");
          continue;
        }
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
      console.log(`[pipeline] ${arts.length} articles (last ${used.hours}h) -> ${clusters.length} clusters (>=${require_cluster().MIN_SOURCES} outlets; similarity ${used.th})`);
      const outs = [];
      const bySrc = {};
      arts.forEach((a) => {
        bySrc[a.source] = (bySrc[a.source] || 0) + 1;
      });
      const saveStatus = () => {
        try {
          db2.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('status', ?)").run(JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), windowHours: used.hours, similarity: used.th, articles: arts.length, clusters: clusters.length, clusterSizes: clusters.map((c) => c.articles.length), articlesBySource: bySrc, feeds: ing.stats || [], outcomes: outs }));
        } catch {
        }
      };
      saveStatus();
      const findExisting = db2.prepare(`SELECT id, source_count FROM stories WHERE sources LIKE ?`);
      const cols = "topic,headline,summary,key_points,why_it_matters,disagreements,confidence,sources,source_count,assessment,read_mins";
      const ins = db2.prepare(`INSERT INTO stories (cluster_key,${cols}) VALUES (?,${cols.split(",").map(() => "?").join(",")})`);
      const upd = db2.prepare(`UPDATE stories SET ${cols.split(",").map((c) => c + "=?").join(",")},updated_at=datetime('now') WHERE id=?`);
      const touched = [];
      const { FINANCE_RE } = require_sources();
      const fin = (c) => c.articles.filter((a) => FINANCE_RE.test(a.title + " " + (a.snippet || ""))).length;
      const memo = {
        get: (k) => {
          const r = db2.prepare("SELECT value FROM meta WHERE key=?").get("cl:" + k);
          if (!r) return null;
          const [o, t] = r.value.split("|");
          return Date.now() - +t < 864e5 ? o : null;
        },
        set: (k, o) => db2.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)").run("cl:" + k, o + "|" + Date.now())
      };
      clusters.sort((a, b) => b.articles.length + fin(b) - (a.articles.length + fin(a)));
      let spent = 0;
      const PER_RUN = +(process.env.MAX_SYNTH_PER_RUN || 12);
      for (const c of clusters) {
        let existing = null;
        for (const a of c.articles) {
          existing = findExisting.get("%" + a.url + "%");
          if (existing) break;
        }
        const label = `${c.articles.length} outlets: ${c.articles[0].title.slice(0, 70)}`;
        if (existing && c.articles.length - existing.source_count < +(process.env.RESYNTH_MIN_GROWTH || 1)) {
          outs.push(label + " \u2192 already published");
          continue;
        }
        if (fin(c) < 1) {
          outs.push(label + " \u2192 not finance news (skipped before AI)");
          continue;
        }
        const seenO = memo.get(c.key);
        if (seenO && !existing) {
          outs.push(label + " \u2192 previously rejected (" + seenO + ")");
          continue;
        }
        if (spent >= PER_RUN) {
          outs.push(label + " \u2192 queued for the next run (per-run limit)");
          continue;
        }
        spent++;
        try {
          await fillFullText(c.articles);
          const s = await synthesise(c.articles);
          if (!s) {
            memo.set(c.key, "no result");
            outs.push(label + " \u2192 no result");
            continue;
          }
          if (s.same_event === false) {
            memo.set(c.key, "different events");
            outs.push(label + " \u2192 sources were different events");
            continue;
          }
          if (c.articles.length < 3 && s.confidence === "HIGH") s.confidence = "MEDIUM";
          if (s.uk_relevance != null && s.uk_relevance < 3) {
            console.log("  - skipped (low UK relevance):", s.headline);
            memo.set(c.key, "low UK relevance");
            outs.push(label + " \u2192 skipped, low UK relevance");
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
          outs.push(label + " \u2192 published");
        } catch (e) {
          console.log("  ! synth failed:", e.message);
          outs.push(label + " \u2192 AI step failed: " + String(e.message).slice(0, 100));
        }
      }
      console.log(`[pipeline] ${touched.length} reports written/updated`);
      saveStatus();
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
      if (process.env.BRIEF_WEEKDAYS_ONLY === "1" && ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(now))) return false;
      return l.hour >= 5 && (!last || last.value !== l.day);
    }
    function sevenAmLondon(now = /* @__PURE__ */ new Date()) {
      const l = londonNow(now);
      for (const h of [7, 6]) {
        const d = /* @__PURE__ */ new Date(`${l.day}T0${h}:00:00Z`), p = londonNow(d);
        if (p.day === l.day && p.hour === 7) return d > now ? d : null;
      }
      return null;
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
      const auto = process.env.BUTTONDOWN_AUTOSEND === "1", at = auto ? sevenAmLondon() : null;
      const post = (payload) => fetch("https://api.buttondown.email/v1/emails", { method: "POST", headers: { Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ subject, body: body(sel, extra), ...payload }) });
      if (auto && !at && londonNow().hour < 7) throw new Error("could not work out 07:00 London time");
      const res = await post(!auto ? { status: "draft" } : at ? { status: "scheduled", publish_date: at.toISOString() } : { status: "about_to_send" });
      if (!res.ok) throw new Error(`Buttondown ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { subject, mode: !auto ? "draft" : at ? `scheduled for ${at.toISOString()}` : "sent" };
    }
    module2.exports = { briefDue, markSent, markdown, body, publish, londonNow, sevenAmLondon };
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
      if (l.hour < 5) return null;
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
      return `<div style="background:#000;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#b3b3b3"><div style="max-width:600px;margin:auto;border:1px solid #242424;padding:28px"><table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:4px"><tr><td style="padding-right:10px">${logoImg(30)}</td><td style="color:#fff;letter-spacing:.4em;font-size:13px;font-weight:700">RECON</td></tr></table><div style="color:#7a7a7a;letter-spacing:.14em;font-size:10px;margin-bottom:20px">UK MORNING BRIEF</div>${inner}</div></div>`;
    }
    var DAILY_STORIES = () => +(process.env.DAILY_STORIES || 8);
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
    var strip = (pos) => `<div style="background:${T.ink};color:#000000;text-align:center;font-family:${SANS};font-weight:600;font-size:9px;line-height:1;letter-spacing:.26em;padding:7px 8px;text-transform:uppercase">Unclassified // Open-source intelligence // For information only</div>`;
    var SITE = () => String(process.env.SITE_URL || process.env.BASE_URL || "").replace(/\/+$/, "");
    var imgOK = () => /^https:\/\//.test(SITE());
    var logoImg = (h) => imgOK() ? `<img src="${SITE()}/logo.png" alt="" height="${h}" style="display:block;border:0;height:${h}px;width:auto">` : "";
    var wmBg = (pos) => imgOK() ? `background-image:url(${SITE()}/logo-wm.png);background-repeat:no-repeat;background-position:${pos};` : "";
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
    function kpiBoardCompact() {
      const r = loadRates();
      if (!r || !r.banks || !r.banks.length) return "";
      const short = (b) => b.marketProb ? `~${Math.round(b.marketProb.pct)}% ${b.marketProb.dir === "HOLD" ? "HOLD" : (b.marketProb.dir === "HIKE" ? "+" : "-") + b.marketProb.bp + "bp"}` : b.market || "";
      const line = (k, v) => `<div style="margin-top:9px">${label(k, "font-size:9px;letter-spacing:.12em")}<div style="margin-top:3px;font-family:${SANS};font-size:11.5px;line-height:1.35;color:${T.sub}">${v}</div></div>`;
      const cell = (b) => {
        const nx = new Date(b.next), when = isNaN(nx) ? esc(b.nextLabel || "") : `${String(nx.getUTCDate()).padStart(2, "0")} ${MON[nx.getUTCMonth()]}`;
        return `<td width="33%" valign="top" style="background:${T.panel};border:1px solid ${T.line};padding:12px 10px 12px"><div>${label(esc(b.code), "font-size:10px;color:" + T.ink)}</div><div style="margin-top:2px">${label(esc(b.rateLabel), "font-size:8.5px;letter-spacing:.08em")}</div>
<div style="margin-top:10px;font-family:${SANS};font-weight:600;font-size:24px;line-height:1.1;letter-spacing:-.035em;color:#ffffff;white-space:nowrap">${esc(b.rate)}<span style="font-size:11px;font-weight:500;color:${T.sub}">${esc(b.unit || "%")}</span></div>
<div style="margin-top:10px;border-top:1px solid ${T.line}"></div>${line("Last", tag(esc(b.lastMove), "ink"))}${line("Next", `<span style="font-family:${MONO};color:${T.ink}">${when}</span><br>${mono(tminus(b.next), "font-size:10px")}`)}${line("Market", `${esc(short(b))}${b.stale ? ` ${tag("STALE", "dim")}` : ""}`)}</td>`;
      };
      const gap = `<td width="6" style="font-size:0;line-height:0">&nbsp;</td>`;
      return `${sec("&sect;1 &middot; Policy rates")}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr>${r.banks.slice(0, 3).map(cell).join(gap)}</tr></table><div style="margin:8px 0 0">${mono(`AS OF ${String(r.asOf || "").toUpperCase()} &middot; MARKET PRICING IS INDICATIVE`, "font-size:10.5px")}</div>`;
    }
    function kpiBoard() {
      if (process.env.BRIEF_STYLE !== "full") return kpiBoardCompact();
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
    function compactHTML(s) {
      const srcs = JSON.parse(s.sources), an = s.analysis ? JSON.parse(s.analysis) : null, l = link(s.id), [pl, pk] = precOf(s);
      const metaLeft = s.kind === "RELEASE" ? `${label("Source", "margin-right:8px")}${mono(`${esc((srcs[0] || {}).name || "")} &middot; PRIMARY DOCUMENT`, "color:" + T.sub)}` : `${label("Sources")}&nbsp;${mono(String(s.source_count), "color:" + T.sub)} &nbsp;&nbsp; ${label("Confidence")}&nbsp;${squares(s.confidence)}&nbsp;${mono(esc(s.confidence), "color:" + T.sub)}`;
      const det = s.kind === "RELEASE" && s.read_mins ? `Assessment &middot; ${s.read_mins} min` : s.read_mins ? `Assessment &middot; ${s.read_mins} min` : "Details";
      const btn = l ? `<a href="${esc(l)}" style="font-family:${SANS};font-weight:600;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${T.ink};text-decoration:none;border-bottom:1px solid ${T.ink};padding-bottom:2px">${det}&nbsp;&rarr;</a>` : "";
      const head = esc(s.headline);
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid ${T.line};table-layout:fixed"><tr><td style="padding:24px 0 22px;word-wrap:break-word;overflow-wrap:break-word">
<div style="margin-bottom:11px">${mono(`RPT-${String(s.id).padStart(4, "0")}`)}&nbsp;&nbsp;${tag(pl, pk)}&nbsp;&nbsp;${label(esc(s.topic))}&nbsp;&nbsp;${mono(ago(s.updated_at.replace(" ", "T") + "Z"))}</div>
<div style="font-family:${SANS};font-weight:600;font-size:23px;line-height:1.25;letter-spacing:-.02em;margin:0 0 12px">${l ? `<a href="${esc(l)}" style="color:#ffffff;text-decoration:none">${head}</a>` : `<span style="color:#ffffff">${head}</span>`}</div>
<div style="font-family:${SANS};font-size:15.5px;line-height:1.6;color:${T.sub}"><b style="font-family:${MONO};font-size:10.5px;letter-spacing:.2em;color:${T.ink}">BLUF</b>&nbsp;&nbsp;${esc(s.summary)}</div>
${an ? `<div style="margin-top:14px;padding-left:12px;border-left:2px solid ${T.ink};font-family:${SANS};font-size:14.5px;line-height:1.55;color:${T.ink}"><span style="font-family:${MONO};font-weight:700;font-size:9.5px;letter-spacing:.14em;background:${T.ink};color:#000000;padding:3px 6px">RECON TAKE</span>&nbsp;&nbsp;${esc(an.thesis)}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px"><tr><td valign="middle">${metaLeft}</td><td align="right" valign="middle" style="white-space:nowrap;padding-left:10px">${btn}</td></tr></table>
</td></tr></table>`;
    }
    function storyHTML(s) {
      if (process.env.BRIEF_STYLE !== "full") return compactHTML(s);
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
    var subjectFor = (sel) => `RECON ${(/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })} \xB7 ${sel.all[0] ? sel.all[0].headline.replace(/^(DEMO REPORT|SAMPLE[A-Z :]*): ?/, "").slice(0, 70) : "UK morning brief"}`;
    function briefBody(sel, { footer = "" } = {}) {
      const mins = readMins(sel.all), site = SITE();
      const releases = sel.releases.length ? `${sec("&sect;3 &middot; Official releases")}${sel.releases.map(storyHTML).join("")}` : "";
      let pollQ = "";
      try {
        if (process.env.POLL_API) pollQ = (require_poll().pollPayload().poll || {}).question || "";
      } catch {
      }
      const btn = (txt, href, solid) => `<a href="${esc(href)}" style="display:inline-block;font-family:${MONO};font-weight:700;font-size:12px;letter-spacing:.18em;text-decoration:none;padding:11px 22px;text-transform:uppercase;${solid ? `background:${T.ink};color:#000000;border:1px solid ${T.ink}` : `color:${T.ink};border:1px solid ${T.ink}`}">${txt}</a>`;
      const dateShort = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).replace(/,/g, "").toUpperCase();
      const poll2 = pollQ && site ? `${sec("&sect;4 &middot; Daily poll")}<div style="font-family:${SANS};font-weight:600;font-size:22px;line-height:1.3;letter-spacing:-.02em;color:#ffffff;margin:0 0 16px">${esc(pollQ)}</div>${btn("Yes", site + "/#pollsec")}&nbsp;&nbsp;${btn("No", site + "/#pollsec")}<div style="margin-top:10px">${mono("VOTE AND SEE THE LIVE RESULT ON RECON", "font-size:10.5px")}</div>` : "";
      const cta = site ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:34px;border-top:1px solid ${T.line};${wmBg("right 6px bottom 8px")}"><tr><td height="300" valign="top" style="padding:28px 0 8px;height:300px">${logoImg(54)}<div style="font-family:${SANS};font-weight:600;font-size:28px;line-height:1.15;letter-spacing:-.03em;color:#ffffff;margin:16px 0 10px">Full reports. Every morning.</div><div style="font-family:${SANS};font-size:15px;line-height:1.55;color:${T.sub};margin:0 0 18px">Read the complete RECON assessments on the website.</div>${btn(esc(site.replace(/^https?:\/\//, "")), site, true)}</td></tr></table>` : "";
      const html = min(`<div style="background:${T.bg};font-family:${SANS};color:${T.ink}">${strip()}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid ${T.line}"><tr><td style="padding:16px 20px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding-right:12px">${logoImg(36)}</td><td style="font-family:${SANS};font-weight:700;font-size:15px;letter-spacing:.4em;color:#ffffff">RECON</td></tr></table></td><td align="right" style="padding:16px 20px">${mono(dtg())}</td></tr></table>
<div style="padding:0 20px 8px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${wmBg("right 6px bottom 8px")}"><tr><td height="310" style="padding:34px 0 26px;height:310px">${label("SITREP &middot; United Kingdom &middot; " + dateShort)}<div style="font-family:${SANS};font-weight:600;font-size:38px;line-height:1.05;letter-spacing:-.035em;color:#ffffff;margin:14px 0 12px">UK Market Intelligence.</div><div style="font-family:${SANS};font-size:16px;line-height:1.55;color:${T.sub};max-width:460px">${sel.reports.length || "No"} verified report${sel.reports.length === 1 ? "" : "s"} from rates, banking, markets and the economy. Every story is confirmed by two or more outlets. Tube read ${mins} min.</div><div style="margin-top:16px">${tag("OPEN SOURCE", "ink")}&nbsp;&nbsp;${mono("VERIFIED &middot; NUMBERS CHECKED &middot; SOURCED", "font-size:10px;letter-spacing:.12em")}</div></td></tr></table>
${kpiBoard()}${sec("&sect;2 &middot; Intelligence reports")}${sel.reports.map(storyHTML).join("") || `<p style="color:${T.sub}">No corroborated stories yet today.</p>`}${releases}${poll2}${cta}
<div style="padding:22px 0 20px;font-family:${MONO};font-size:10.5px;line-height:1.7;letter-spacing:.04em;color:${T.mute};text-transform:uppercase">AI-generated summaries of third-party reporting; may contain errors. Verify via the linked sources. General information only, not financial advice.${footer}</div></div>${strip()}</div>`);
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
      return { lastMove: recent ? dir : "HOLD", lastMoveDetail: recent ? `${dir === "HIKE" ? "+" : ""}${change.bp}bp to ${pct(last.value)}% on ${human(change.date)}` : `Unchanged since ${human(change.date)} (last move ${change.bp > 0 ? "+" : ""}${change.bp}bp)` };
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
        url: (s, alt) => `https://${alt ? "sdw-wsrest.ecb.europa.eu" : "data-api.ecb.europa.eu"}/service/data/FM/B.U2.EUR.4F.KR.${s}.LEV?startPeriod=${new Date(Date.now() - 800 * 864e5).toISOString().slice(0, 10)}&format=csvdata`,
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
      const r = await fetchFn(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(25e3) });
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
          const got = src.series ? await Promise.all(src.series.map((s, i) => getText(src.url(s), fetchFn).catch((e0) => bank.code === "ECB" ? getText(src.url(s, true), fetchFn).catch((e1) => {
            throw new Error(`${e0.message}; fallback ${e1.message}`);
          }) : Promise.reject(e0)).catch((e) => {
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
      try {
        require_db().prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('rates_status', ?)").run(JSON.stringify({ at: now.toISOString(), results }));
      } catch {
      }
      return results;
    }
    module2.exports = { refresh, series, lastChange, csvRows, SOURCES, isoOf };
    if (require.main === module2) {
      require("dotenv").config();
      refresh().then(() => process.exit(0));
    }
  }
});

// lib/brand.js
var require_brand = __commonJS({
  "lib/brand.js"(exports2, module2) {
    var b = (s) => Buffer.from(s, "base64");
    var D = { "logo": "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", "watermark": "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", "favicon": "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", "touch": "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" };
    module2.exports = {
      logo: D.logo,
      watermark: D.watermark,
      favicon: D.favicon,
      touch: D.touch,
      files: () => ({ "logo.png": b(D.logo), "logo-wm.png": b(D.watermark), "favicon.png": b(D.favicon), "apple-touch-icon.png": b(D.touch) })
    };
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
        fs.writeFileSync(path.join(out, "status.html"), `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>RECON status</title><style>body{background:#000;color:#ccc;font:13px ui-monospace,monospace;padding:24px;max-width:1100px;margin:auto}td,th{padding:4px 12px 4px 0;text-align:left;vertical-align:top}b{color:#fff}h1{font-size:15px;color:#fff}</style><h1>RECON \xB7 pipeline status</h1>${st ? `<p>Last run ${e(st.at)}<br>Looked back ${st.windowHours}h \xB7 ${st.articles} articles \xB7 ${st.clusters} corroborated stories (sizes ${st.clusterSizes.join(", ") || "none"}) \xB7 similarity ${st.similarity}</p><p>Articles per outlet: ${by || "none"}</p><p><b>Policy rates (official feeds)</b><br>${(() => {
          try {
            const rs = JSON.parse(db2.prepare("SELECT value FROM meta WHERE key='rates_status'").get().value);
            return Object.entries(rs.results).map(([k, v]) => `${k}: ${v.ok ? "OK " + e(v.rate) + " (as at " + e(v.asAt) + ")" : "FAILED " + e(v.error)}`).join("<br>");
          } catch {
            return "no run recorded";
          }
        })()}</p><p><b>Instagram (last attempt)</b><br>${(() => {
          try {
            const s = JSON.parse(db2.prepare("SELECT value FROM meta WHERE key='ig_status'").get().value);
            return ["carousel", "reel"].map((f) => s[f] ? `${f}: ${s[f].ok ? "POSTED " + e(s[f].permalink || s[f].id) : "FAILED " + e(s[f].error)}` : "").filter(Boolean).join("<br>") + `<br>at ${e(s.at)}`;
          } catch {
            return "nothing posted yet";
          }
        })()}</p><p><b>What happened to each candidate story</b><br>${(st.outcomes || []).map(e).join("<br>") || "none"}</p><p><b>Story candidates</b><br>${(st.outcomes || []).map(e).join("<br>") || "none formed"}</p><table><tr><th>State<th>Feed<th>Items kept<th>Note</tr>${rows}</table>` : "<p>No run recorded yet.</p>"}`);
      } catch (err) {
        console.log("[site] status page skipped:", err.message);
      }
      for (const [f, buf] of Object.entries(require_brand().files())) fs.writeFileSync(path.join(out, f), buf);
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
    const enough = sel.all.length >= 3 || sel.all.length >= 1 && bd.londonNow().hour >= 8;
    if (enough) {
      try {
        const rates = ratesPayload().banks.map((b) => `${b.code} ${b.rate}${b.unit || "%"}`).join(" \xB7 ");
        const info = await (process.env.NEWSLETTER_PROVIDER === "resend" ? rsd : bd).publish(sel, { mins: nl.readMins(sel.all), rates, date: (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) });
        bd.markSent();
        console.log(`[brief] ${info.mode}: ${info.subject}`);
      } catch (e) {
        console.log("[brief] FAILED:", e.message);
      }
    } else console.log(`[brief] waiting for more stories (${sel.all.length} so far)`);
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
