const DEFAULT_BRIDGE = process.env.VLR_LIVE_BRIDGE || "https://vctgemini.vercel.app";
const FALLBACK_BRIDGES = [
  "https://vctgemini.vercel.app",
  "https://vlrggapi.vercel.app"
];

const LOCAL_API = process.env.VLR_LOCAL_API || "http://127.0.0.1:3002/api";
const PUBLIC_EXACT_API = String(process.env.VLR_PUBLIC_EXACT_API || "https://vlrgg.metehansenyer.tech/api").replace(/\/+$/, "");

const profileCache = new Map();
const detailCache = new Map();
const eventLogoCache = new Map();
const hostedDetailCache = new Map();
const eventSearchCache = new Map();
const resultLookupCache = new Map();
const publicExactMatchCache = new Map();
const publicEventLogoCache = new Map();
const publicEventMatchCache = new Map();
const vlrPageCache = new Map();
let eventsCache = { at: 0, items: [] };
let upcomingBridgeCache = { at: 0, preferred: "", value: null };
let localUpcomingCache = { at: 0, items: [] };

function normBase(value) {
  return String(value || "").replace(/\/+$/, "");
}

function absUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `https://www.vlr.gg${s}`;
  return s;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
function numericOr(value, fallback = 0) {
  return hasNumericValue(value) ? Number(value) : fallback;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(esports|gaming|team)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeTeamText(value) {
  let text = String(value || "").trim();
  if (!text) return "";

  const patterns = [
    /^(?:next|upcoming|live|final|featured)\s*[:·\-|]+\s*/i,
    /^(?:match|series)\s*[:·\-|]+\s*/i,
    /^\[(?:next|live|final)\]\s*/i
  ];

  for (const pattern of patterns) text = text.replace(pattern, "").trim();
  text = text.replace(/\s{2,}/g, " ");
  return text;
}

function similarity(a, b) {
  const A = normalize(a);
  const B = normalize(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.88;

  const aa = new Set(A.split(/\s+/).filter(Boolean));
  const bb = new Set(B.split(/\s+/).filter(Boolean));
  let common = 0;
  for (const token of aa) if (bb.has(token)) common++;
  return common / Math.max(aa.size, bb.size, 1);
}

function matchIdFromPage(value) {
  const s = String(value || "");
  const m = s.match(/vlr\.gg\/(\d+)/i) || s.match(/^\/?(\d+)/);
  return m ? m[1] : "";
}
function eventIdFromPage(value) {
  const s = String(value || "");
  const m = s.match(/(?:vlr\.gg)?\/?event\/(\d+)/i);
  return m ? m[1] : "";
}

function parseVlrMatchId(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?vlr\.gg\/(\d+)(?:[/?#-]|$)/i);
  return m ? m[1] : "";
}

function extractSegments(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.segments)) return payload.segments;
  if (Array.isArray(payload?.data?.segments)) return payload.data.segments;
  if (Array.isArray(payload?.data?.data?.segments)) return payload.data.data.segments;
  return [];
}


function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
function stripHtml(value) {
  return decodeHtml(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
function firstMatch(text, regex, group = 1) {
  const m = String(text || "").match(regex);
  return m ? String(m[group] || "").trim() : "";
}
function attrFromTag(tag, attr) {
  const escaped = String(attr).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(tag, new RegExp(`${escaped}=["']([^"']+)["']`, "i"));
}
function teamIdFromHref(value) {
  const m = String(value || "").match(/\/team\/(\d+)/i);
  return m ? m[1] : "";
}
async function getHtml(url, timeoutMs = 14000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"
      },
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store"
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 160)}`);
    return raw;
  } finally {
    clearTimeout(timer);
  }
}
function extractClassElement(html, className) {
  const cls = String(className).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  const m = String(html || "").match(re);
  return m ? m[0] : "";
}
function extractAllClassText(html, className) {
  const cls = String(className).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  const out = [];
  for (const m of String(html || "").matchAll(re)) out.push(stripHtml(m[2]));
  return out.filter(Boolean);
}
function parseVlrTeamBlock(html, mod) {
  const re = new RegExp(`<a[^>]*class=["'][^"']*match-header-link[^"']*\\bmod-${mod}\\b[^"']*["'][^>]*[\\s\\S]*?<\\/a>`, "i");
  const block = firstMatch(html, re, 0);
  if (!block) return null;
  const opening = firstMatch(block, /^<a[^>]*>/i, 0);
  const href = attrFromTag(opening, "href");
  const name = stripHtml(firstMatch(block, /<[^>]*class=["'][^"']*wf-title-med[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i));
  const imgTag = firstMatch(block, /<img[^>]*class=["'][^"']*match-header-link-img[^"']*["'][^>]*>/i, 0) || firstMatch(block, /<img[^>]*>/i, 0);
  return { id: teamIdFromHref(href) || null, name: name || "TBD", logo: absUrl(attrFromTag(imgTag, "src")), score: null };
}
function extractVlrSeriesScore(html) {
  const raw = String(html || "");
  const tokens = [];
  const directTokenRe = /<([a-z0-9]+)[^>]*class=["'][^"']*\bmatch-header-vs-score\b[^"']*["'][^>]*>\s*([^<]{1,12})\s*<\/\1>/gi;
  for (const m of raw.matchAll(directTokenRe)) {
    const token = stripHtml(m[2]);
    if (/^\d+$/.test(token) || /^:$/.test(token)) tokens.push(token);
  }
  const numericTokens = tokens.filter(t => /^\d+$/.test(t)).map(Number);
  if (numericTokens.length >= 2) return [numericTokens[0], numericTokens[1]];

  const modRe = /<([a-z0-9]+)[^>]*class=["'][^"']*\bmatch-header-vs-score(?:-[a-z0-9_-]+)?\b[^"']*["'][^>]*>\s*(\d+)\s*<\/\1>/gi;
  const nums = [];
  for (const m of raw.matchAll(modRe)) nums.push(Number(m[2]));
  if (nums.length >= 2) return [nums[0], nums[1]];

  const idx = raw.search(/match-header-vs-score/i);
  if (idx >= 0) {
    const chunk = raw.slice(idx, idx + 2200);
    const textChunk = stripHtml(chunk);
    const m = textChunk.match(/\b(\d+)\s*:\s*(\d+)\b/) || textChunk.match(/\b(\d+)\s*[–—-]\s*(\d+)\b/);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return null;
}

function parseVlrMatchHtml(matchId, html) {
  const raw = String(html || "");
  if (!raw || !/match-header/i.test(raw)) return null;

  const notes = extractAllClassText(raw, "match-header-vs-note");
  const noteText = notes.join(" | ").toLowerCase();
  const seriesScore = extractVlrSeriesScore(raw);
  const scoreText = seriesScore ? `${seriesScore[0]}:${seriesScore[1]}` : "";

  let status = "upcoming";
  if (/\bfinal\b|completed|finished/.test(noteText)) status = "completed";
  else if (/\blive\b|ongoing|in progress/.test(noteText)) status = "running";
  else if (seriesScore) status = "completed";

  const team1 = parseVlrTeamBlock(raw, 1);
  const team2 = parseVlrTeamBlock(raw, 2);
  if (seriesScore) {
    if (team1) team1.score = Number(seriesScore[0]);
    if (team2) team2.score = Number(seriesScore[1]);
  }

  const eventBlockMatch = raw.match(/<a[^>]*href=["']\/event\/(\d+)\/[^"']*["'][^>]*class=["'][^"']*match-header-event[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
    || raw.match(/<a[^>]*class=["'][^"']*match-header-event[^"']*["'][^>]*href=["']\/event\/(\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  const eventId = eventBlockMatch ? eventBlockMatch[1] : "";
  const eventBlock = eventBlockMatch ? eventBlockMatch[2] : "";
  const eventName = stripHtml(
    firstMatch(eventBlock, /<[^>]*style=["'][^"']*font-weight\s*:\s*700[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
    || firstMatch(eventBlock, /<[^>]*class=["'][^"']*match-header-event-name[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
  );
  const stage = stripHtml(firstMatch(eventBlock, /<[^>]*class=["'][^"']*match-header-event-series[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i));
  const eventImgTag = firstMatch(eventBlock, /<img[^>]*>/i, 0);
  const eventLogo = absUrl(attrFromTag(eventImgTag, "src"));
  const bo = notes.find(n => /^bo\s*\d+/i.test(n)) || "";

  return {
    id: String(matchId),
    status,
    event: eventName,
    eventId,
    eventLogo,
    stage,
    format: bo,
    team1,
    team2,
    maps: [],
    sourceDebug: { directVlrPage: true, notes, scoreText }
  };
}
async function getVlrMatchPage(matchId) {
  const id = String(matchId || "").trim();
  if (!id) return null;
  const cached = vlrPageCache.get(id);
  if (cached && Date.now() - cached.at < 45 * 1000) return cached.value;
  try {
    const html = await getHtml(`https://www.vlr.gg/${encodeURIComponent(id)}`, 16000);
    const value = parseVlrMatchHtml(id, html);
    vlrPageCache.set(id, { at: Date.now(), value });
    return value;
  } catch {
    vlrPageCache.set(id, { at: Date.now(), value: null });
    return null;
  }
}
function mergeTeamDetails(preferred, fallback) {
  if (!preferred && !fallback) return null;
  return {
    ...(fallback || {}),
    ...(preferred || {}),
    id: preferred?.id || fallback?.id || null,
    name: preferred?.name && preferred.name !== "TBD" ? preferred.name : (fallback?.name || "TBD"),
    tag: preferred?.tag || fallback?.tag || fallback?.acronym || "",
    logo: preferred?.logo || fallback?.logo || "",
    score: hasNumericValue(preferred?.score) ? Number(preferred.score) : numericOr(fallback?.score, 0)
  };
}
function mergeExactDetails(preferred, ...fallbacks) {
  const all = [preferred, ...fallbacks].filter(Boolean);
  if (!all.length) return null;
  const out = { ...all[all.length - 1] };
  for (let i = all.length - 2; i >= 0; i--) Object.assign(out, all[i]);
  let t1 = null, t2 = null;
  for (let i = all.length - 1; i >= 0; i--) {
    t1 = mergeTeamDetails(all[i]?.team1, t1);
    t2 = mergeTeamDetails(all[i]?.team2, t2);
  }
  out.team1 = t1;
  out.team2 = t2;
  out.event = all.find(x => x?.event)?.event || out.event || "VALORANT";
  out.stage = all.find(x => x?.stage)?.stage || out.stage || "";
  out.format = all.find(x => x?.format)?.format || out.format || "";
  out.eventLogo = all.find(x => x?.eventLogo)?.eventLogo || out.eventLogo || "";
  out.eventId = all.find(x => x?.eventId)?.eventId || out.eventId || "";
  out.status = preferred?.status || out.status || "upcoming";
  return out;
}

async function getJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "VLROverlayForVCTMatches/5.4"
      },
      signal: ctrl.signal,
      cache: "no-store"
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 160)}`);
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}


function unwrapV2Data(payload) {
  if (!payload) return null;
  if (payload?.status === "success" && payload?.data) return payload.data;
  if (payload?.data?.data) return payload.data.data;
  if (payload?.data) return payload.data;
  return payload;
}

function unwrapPublicPayload(payload) {
  if (!payload) return null;
  if (payload?.success === true && payload?.data !== undefined) return payload.data;
  if (payload?.status === "success" && payload?.data !== undefined) return payload.data;
  return payload?.data ?? payload;
}

function publicStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^(live|running|ongoing|in[_ -]?progress|playing)$/.test(raw)) return "running";
  if (/^(completed|complete|finished|final|ended|concluded|result)$/.test(raw)) return "completed";
  if (/^(upcoming|scheduled|pending|not[_ -]?started|future|tbd)$/.test(raw)) return "upcoming";
  return raw;
}

function publicMatchToLocal(detail) {
  if (!detail) return null;
  const team1 = detail?.team1 || detail?.teams?.[0] || null;
  const team2 = detail?.team2 || detail?.teams?.[1] || null;
  const eventObj = detail?.event && typeof detail.event === "object" ? detail.event : null;
  const eventName = typeof detail?.event === "string"
    ? detail.event
    : (eventObj?.name || detail?.tournament_name || detail?.tournament?.name || "");
  const eventId = String(
    detail?.eventId || detail?.event_id || eventObj?.id || detail?.tournamentId || detail?.tournament_id || detail?.tournament?.id || ""
  ).trim();

  return {
    status: publicStatus(detail?.status || detail?.state || detail?.match_status || detail?.matchStatus),
    event: eventName,
    eventId,
    eventLogo: absUrl(
      detail?.eventLogo || detail?.event_logo || eventObj?.logo || eventObj?.logo_url ||
      detail?.tournament_icon || detail?.tournament?.logo || detail?.tournament?.logo_url || ""
    ),
    stage: detail?.stage || detail?.round || detail?.round_info || eventObj?.series || detail?.series || "",
    format: detail?.format || detail?.best_of || detail?.bestOf || "",
    team1: team1 ? {
      id: team1?.id || null,
      name: team1?.name || detail?.team1_name || "TBD",
      tag: team1?.tag || team1?.acronym || "",
      logo: absUrl(team1?.logo || team1?.image || detail?.team1_logo || ""),
      score: toNum(team1?.score ?? detail?.score_team1 ?? detail?.score1, 0)
    } : (detail?.team1_name ? {
      id: null, name: detail.team1_name, tag: "", logo: absUrl(detail?.team1_logo || ""), score: toNum(detail?.score_team1 ?? detail?.score1, 0)
    } : null),
    team2: team2 ? {
      id: team2?.id || null,
      name: team2?.name || detail?.team2_name || "TBD",
      tag: team2?.tag || team2?.acronym || "",
      logo: absUrl(team2?.logo || team2?.image || detail?.team2_logo || ""),
      score: toNum(team2?.score ?? detail?.score_team2 ?? detail?.score2, 0)
    } : (detail?.team2_name ? {
      id: null, name: detail.team2_name, tag: "", logo: absUrl(detail?.team2_logo || ""), score: toNum(detail?.score_team2 ?? detail?.score2, 0)
    } : null),
    maps: Array.isArray(detail?.maps) ? detail.maps : []
  };
}

async function getPublicExactMatch(matchId) {
  const id = String(matchId || "").trim();
  if (!id) return null;
  const cached = publicExactMatchCache.get(id);
  if (cached && Date.now() - cached.at < 45 * 1000) return cached.value;

  try {
    const payload = await getJson(`${PUBLIC_EXACT_API}/matches/${encodeURIComponent(id)}`, 16000);
    const detail = unwrapPublicPayload(payload);
    if (detail && (detail?.id || detail?.team1 || detail?.team1_name || detail?.teams)) {
      const value = publicMatchToLocal(detail);
      publicExactMatchCache.set(id, { at: Date.now(), value });
      return value;
    }
  } catch {}

  publicExactMatchCache.set(id, { at: Date.now(), value: null });
  return null;
}

async function getPublicEventLogo(eventId, eventName) {
  const key = `${String(eventId || "").trim()}|${normalize(eventName)}`;
  const cached = publicEventLogoCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.logo;

  let id = String(eventId || "").trim();
  let directLogo = "";

  if (!id && eventName) {
    try {
      const payload = await getJson(`${PUBLIC_EXACT_API}/search?q=${encodeURIComponent(eventName)}&type=events`, 14000);
      const raw = unwrapPublicPayload(payload);
      const items = Array.isArray(raw)
        ? raw
        : (raw?.events || raw?.results?.events || raw?.results || []);
      let best = null;
      let bestScore = 0;
      for (const ev of Array.isArray(items) ? items : []) {
        const score = similarity(ev?.name || ev?.title || ev?.event_name || "", eventName);
        if (score > bestScore) { best = ev; bestScore = score; }
      }
      if (best && bestScore >= .32) {
        id = String(best?.id || best?.event_id || best?.eventId || "").trim();
        directLogo = absUrl(best?.logo_url || best?.logo || best?.img || best?.image || "");
      }
    } catch {}
  }

  if (id) {
    try {
      const payload = await getJson(`${PUBLIC_EXACT_API}/events/${encodeURIComponent(id)}`, 16000);
      const event = unwrapPublicPayload(payload);
      const logo = absUrl(event?.logo_url || event?.logo || event?.img || event?.image || event?.eventLogo || "");
      if (logo) {
        publicEventLogoCache.set(key, { at: Date.now(), logo });
        return logo;
      }
    } catch {}
  }

  publicEventLogoCache.set(key, { at: Date.now(), logo: directLogo });
  return directLogo;
}

async function getPublicEventMatchResult(eventId, matchId) {
  const eid = String(eventId || "").trim();
  const mid = String(matchId || "").trim();
  if (!eid || !mid) return null;
  const key = `${eid}|${mid}`;
  const cached = publicEventMatchCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;

  try {
    const payload = await getJson(`${PUBLIC_EXACT_API}/events/${encodeURIComponent(eid)}`, 16000);
    const event = unwrapPublicPayload(payload);
    const items = Array.isArray(event?.matches) ? event.matches : [];
    const item = items.find(m => String(m?.id || m?.match_id || m?.matchId || "") === mid);
    if (item) {
      const t1 = item?.team1 || item?.teams?.[0] || {};
      const t2 = item?.team2 || item?.teams?.[1] || {};
      const value = {
        status: publicStatus(item?.status || "completed") || "completed",
        event: event?.name || "",
        eventId: eid,
        eventLogo: absUrl(event?.logo_url || event?.logo || event?.image || ""),
        stage: item?.stage || item?.round || item?.event_series || "",
        team1: {
          id: t1?.id || null, name: t1?.name || item?.team1_name || "TBD",
          logo: absUrl(t1?.logo || t1?.image || ""),
          score: numericOr(t1?.score ?? item?.score_team1 ?? item?.score1, 0)
        },
        team2: {
          id: t2?.id || null, name: t2?.name || item?.team2_name || "TBD",
          logo: absUrl(t2?.logo || t2?.image || ""),
          score: numericOr(t2?.score ?? item?.score_team2 ?? item?.score2, 0)
        }
      };
      publicEventMatchCache.set(key, { at: Date.now(), value });
      return value;
    }
  } catch {}

  publicEventMatchCache.set(key, { at: Date.now(), value: null });
  return null;
}

async function getHostedMatchDetail(matchId, preferredBridge = DEFAULT_BRIDGE) {
  const id = String(matchId || "").trim();
  if (!id) return null;
  const cached = hostedDetailCache.get(id);
  if (cached && Date.now() - cached.at < 30000) return cached.value;

  const candidates = [...new Set([normBase(preferredBridge), ...FALLBACK_BRIDGES.map(normBase)])];
  for (const base of candidates) {
    for (const path of [
      `/v2/match/details?match_id=${encodeURIComponent(id)}`,
      `/match/details?match_id=${encodeURIComponent(id)}`
    ]) {
      try {
        const payload = await getJson(`${base}${path}`, 12000);
        const value = unwrapV2Data(payload);
        const detail = value?.match_id || value?.teams || value?.event ? value : value?.data || null;
        if (detail) {
          hostedDetailCache.set(id, { at: Date.now(), value: { detail, base } });
          return { detail, base };
        }
      } catch {}
    }
  }
  hostedDetailCache.set(id, { at: Date.now(), value: null });
  return null;
}

function hostedDetailToLocal(detail) {
  if (!detail) return null;
  const teams = Array.isArray(detail?.teams) ? detail.teams : [];
  return {
    status: detail?.status || "",
    event: detail?.event?.name || detail?.event || "",
    stage: detail?.event?.series || detail?.series || detail?.stage || "",
    format: detail?.format || detail?.best_of || detail?.bestOf || "",
    team1: teams[0] ? {
      id: teams[0]?.id || null,
      name: teams[0]?.name || "TBD",
      logo: absUrl(teams[0]?.logo || ""),
      score: toNum(teams[0]?.score, 0)
    } : null,
    team2: teams[1] ? {
      id: teams[1]?.id || null,
      name: teams[1]?.name || "TBD",
      logo: absUrl(teams[1]?.logo || ""),
      score: toNum(teams[1]?.score, 0)
    } : null,
    maps: Array.isArray(detail?.maps) ? detail.maps : []
  };
}

async function getEventLogoBySearch(bridge, eventName) {
  const key = normalize(eventName);
  if (!key) return "";
  const cached = eventSearchCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.logo;

  const candidates = [...new Set([normBase(bridge), ...FALLBACK_BRIDGES.map(normBase)])];
  for (const base of candidates) {
    try {
      const payload = await getJson(`${base}/v2/search?q=${encodeURIComponent(eventName)}`, 10000);
      const data = unwrapV2Data(payload);
      const events = data?.segments?.results?.events || data?.results?.events || [];
      let best = null;
      let bestScore = 0;
      for (const ev of Array.isArray(events) ? events : []) {
        const score = similarity(ev?.name || ev?.title || "", eventName);
        if (score > bestScore) { best = ev; bestScore = score; }
      }
      if (best && bestScore >= .35) {
        let logo = absUrl(best?.img || best?.logo || best?.thumb || "");
        const eventId = best?.id || best?.event_id || eventIdFromPage(best?.url_path || best?.url || "");
        if (!logo && eventId) {
          try {
            const detailPayload = await getJson(`${base}/v2/event/${encodeURIComponent(eventId)}`, 10000);
            const detailData = unwrapV2Data(detailPayload);
            logo = absUrl(detailData?.segments?.event?.logo || detailData?.event?.logo || "");
          } catch {}
        }
        if (logo) {
          eventSearchCache.set(key, { at: Date.now(), logo });
          return logo;
        }
      }
    } catch {}
  }

  eventSearchCache.set(key, { at: Date.now(), logo: "" });
  return "";
}


async function findMatchInResults(matchId, preferredBridge = DEFAULT_BRIDGE) {
  const id = String(matchId || "").trim();
  if (!id) return null;

  const cached = resultLookupCache.get(id);
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.value;

  const candidates = [...new Set([normBase(preferredBridge), ...FALLBACK_BRIDGES.map(normBase)])];
  for (const base of candidates) {
    for (const path of [
      "/v2/match?q=results&num_pages=4",
      "/match?q=results&num_pages=4"
    ]) {
      try {
        const payload = await getJson(`${base}${path}`, 18000);
        const items = extractSegments(payload);
        const item = items.find(seg => matchIdFromPage(seg?.match_page) === id);
        if (item) {
          const value = { item, base };
          resultLookupCache.set(id, { at: Date.now(), value });
          return value;
        }
      } catch {}
    }
  }

  resultLookupCache.set(id, { at: Date.now(), value: null });
  return null;
}

async function buildCompletedFromResultItem(item, bridgeBase, details = null) {
  const matchId = matchIdFromPage(item?.match_page);
  if (!matchId) return null;

  const detail1 = details?.team1 || null;
  const detail2 = details?.team2 || null;
  const [team1, team2] = await Promise.all([
    enrichTeam(item?.team1, item?.team1_logo || "", detail1),
    enrichTeam(item?.team2, item?.team2_logo || "", detail2)
  ]);

  const event = String(item?.tournament_name || details?.event || "VALORANT").trim();
  const stage = String(item?.round_info || details?.stage || "Final").trim();
  const detailEventId = String(details?.eventId || details?.event_id || details?.event?.id || "").trim();
  const exactEventLogo = await getPublicEventLogo(detailEventId, event).catch(() => "");
  const eventLogo =
    absUrl(item?.tournament_icon || "") ||
    pickDetailEventLogo(details) ||
    exactEventLogo ||
    await getEventLogo(bridgeBase, event);

  return {
    id: matchId,
    status: "completed",
    bestOf: parseBo(details?.format, null),
    event,
    stage,
    mapName: "",
    eventLogo,
    matchPage: absUrl(item?.match_page || `https://www.vlr.gg/${matchId}`),
    seriesScore: [toNum(item?.score1, 0), toNum(item?.score2, 0)],
    roundScore: [null, null],
    teams: [team1, team2],
    etaText: "",
    etaSeconds: null,
    etaCapturedAt: Date.now(),
    sourceDebug: {
      pinned: true,
      resultFeed: true,
      resultBridge: bridgeBase,
      localDetails: Boolean(details),
      team1Profile: team1.metadataResolved,
      team2Profile: team2.metadataResolved
    }
  };
}

async function getLiveScore(preferredBridge = DEFAULT_BRIDGE) {
  const candidates = [...new Set([
    normBase(preferredBridge),
    ...FALLBACK_BRIDGES.map(normBase)
  ])];

  const errors = [];
  for (const base of candidates) {
    for (const path of ["/v2/match?q=live_score", "/match?q=live_score"]) {
      try {
        const payload = await getJson(`${base}${path}`);
        return { payload, base };
      } catch (err) {
        errors.push(`${base}${path}: ${String(err?.message || err)}`);
      }
    }
  }

  throw new Error(`VLR live score unavailable. ${errors.join(" | ")}`);
}

async function localHealth() {
  try {
    // A real endpoint is a better check than /health because this API always exposes /api.
    const p = await getJson(`${LOCAL_API}/matches/live`, 5000);
    return Boolean(p?.success);
  } catch {
    return false;
  }
}

async function getLocalDetail(matchId) {
  if (!matchId) return null;

  // Only keep metadata for a few seconds. Maps can change during a live match.
  const cached = detailCache.get(matchId);
  if (cached && Date.now() - cached.at < 8000) return cached.value;

  try {
    const p = await getJson(`${LOCAL_API}/matches/${encodeURIComponent(matchId)}`, 8000);
    const value = p?.success ? p.data : null;
    detailCache.set(matchId, { at: Date.now(), value });
    return value;
  } catch {
    detailCache.set(matchId, { at: Date.now(), value: null });
    return null;
  }
}

async function getLocalTeam(teamId) {
  if (!teamId) return null;

  const key = String(teamId);
  const cached = profileCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.value;

  try {
    const p = await getJson(`${LOCAL_API}/teams/${encodeURIComponent(teamId)}`, 8000);
    const value = p?.success ? p.data : null;
    profileCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    profileCache.set(key, { at: Date.now(), value: null });
    return null;
  }
}

function alignDetailTeams(details, liveName1, liveName2) {
  const teams = [details?.team1, details?.team2].filter(Boolean);
  if (teams.length < 2) return [details?.team1 || null, details?.team2 || null];

  const scoreFirst = similarity(teams[0]?.name, liveName1);
  const scoreSecond = similarity(teams[1]?.name, liveName1);
  return scoreFirst >= scoreSecond ? [teams[0], teams[1]] : [teams[1], teams[0]];
}

function usableMap(value) {
  const s = String(value || "").trim();
  if (!s || /^(unknown|tbd|n\/a|none|null)$/i.test(s)) return "";
  return s;
}

function parseBo(format, fallback = 3) {
  const m = String(format || "").match(/bo\s*(\d+)/i);
  return m ? Number(m[1]) : fallback;
}

async function getLiveEvents(bridge) {
  if (eventsCache.items.length && Date.now() - eventsCache.at < 5 * 60 * 1000) {
    return eventsCache.items;
  }

  for (const base of [...new Set([normBase(bridge), ...FALLBACK_BRIDGES.map(normBase)])]) {
    for (const path of ["/v2/events?q=live", "/events?q=live"]) {
      try {
        const p = await getJson(`${base}${path}`, 10000);
        const items = extractSegments(p);
        if (items.length) {
          eventsCache = { at: Date.now(), items };
          return items;
        }
      } catch {}
    }
  }

  return [];
}

async function getEventLogo(bridge, eventName) {
  const key = normalize(eventName);
  const cached = eventLogoCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.logo;

  const events = await getLiveEvents(bridge);
  let best = null;
  let bestScore = 0;
  for (const ev of events) {
    const score = similarity(ev?.title || ev?.name || "", eventName);
    if (score > bestScore) {
      best = ev;
      bestScore = score;
    }
  }

  let logo = bestScore >= 0.30
    ? absUrl(best?.thumb || best?.logo || best?.image || "")
    : "";

  if (!logo) logo = await getEventLogoBySearch(bridge, eventName);
  eventLogoCache.set(key, { at: Date.now(), logo });
  return logo;
}

function pickDetailEventLogo(details) {
  const candidates = [
    details?.eventLogo,
    details?.event_logo,
    details?.eventImage,
    details?.event_image,
    details?.event?.logo,
    details?.event?.image,
    details?.event?.thumb,
    details?.tournament?.logo,
    details?.tournament?.image,
    details?.tournament?.thumb,
    details?.league?.logo,
    details?.league?.image,
    details?.series?.logo,
    details?.series?.image
  ];

  for (const value of candidates) {
    const out = absUrl(value);
    if (out) return out;
  }
  return "";
}

function inferDetailStatus(details) {
  const raw = String(
    details?.status || details?.matchStatus || details?.state || details?.match_state || ""
  ).trim().toLowerCase();

  if (/(live|running|ongoing|in\s*progress|playing|current)/i.test(raw)) return "running";
  if (/(completed|complete|finished|final|ended|concluded|result)/i.test(raw)) return "completed";
  if (/(upcoming|scheduled|pending|not\s*started|future|tbd)/i.test(raw)) return "upcoming";

  const score1 = toNum(details?.team1?.score, NaN);
  const score2 = toNum(details?.team2?.score, NaN);
  if (Number.isFinite(score1) && Number.isFinite(score2) && (score1 > 0 || score2 > 0)) {
    return "completed";
  }

  return "upcoming";
}

async function buildExactMatchFromDetails(id, details, preferredBridge) {
  const [team1, team2] = await Promise.all([
    enrichTeam(details?.team1?.name, details?.team1?.logo || "", details?.team1 || null),
    enrichTeam(details?.team2?.name, details?.team2?.logo || "", details?.team2 || null)
  ]);

  const eventName = typeof details?.event === "string"
    ? details.event
    : (details?.event?.name || details?.tournament?.name || "VALORANT");
  const stageName = details?.stage || details?.event?.series || details?.round || "";
  const eventId = String(details?.eventId || details?.event_id || details?.event?.id || details?.tournament?.id || "").trim();
  const exactEventLogo = await getPublicEventLogo(eventId, eventName).catch(() => "");
  const eventLogo =
    pickDetailEventLogo(details) ||
    exactEventLogo ||
    await getEventLogo(preferredBridge, eventName);

  const status = inferDetailStatus(details);
  const series1 = toNum(details?.team1?.score, 0);
  const series2 = toNum(details?.team2?.score, 0);

  return {
    id,
    status,
    bestOf: parseBo(details?.format, null),
    event: eventName,
    stage: stageName,
    mapName: "",
    eventLogo: eventLogo || "",
    matchPage: `https://www.vlr.gg/${id}`,
    seriesScore: [series1, series2],
    roundScore: [null, null],
    teams: [team1, team2],
    etaText: status === "upcoming" ? "TBD" : "",
    etaSeconds: null,
    etaCapturedAt: Date.now(),
    sourceDebug: {
      pinned: true,
      exactDetails: true,
      inferredStatus: status,
      eventId,
      usedDetailEventLogo: Boolean(eventLogo),
      team1Profile: team1.metadataResolved,
      team2Profile: team2.metadataResolved
    }
  };
}

async function enrichTeam(liveName, liveLogo, detailTeam) {
  const profile = detailTeam?.id ? await getLocalTeam(detailTeam.id) : null;

  // Exact VLR team profile is authoritative for tag/logo.
  const tag = sanitizeTeamText(profile?.tag || "").toUpperCase();

  return {
    id: detailTeam?.id || profile?.id || null,
    name: sanitizeTeamText(profile?.name || detailTeam?.name || liveName || "TBD") || "TBD",
    acronym: sanitizeTeamText(tag || ""),
    logo: absUrl(profile?.logo || detailTeam?.logo || liveLogo || ""),
    metadataResolved: Boolean(profile?.tag && (profile?.logo || detailTeam?.logo || liveLogo))
  };
}


function parseEtaSeconds(value) {
  let text = String(value || "").trim().toLowerCase();
  if (!text) return Number.POSITIVE_INFINITY;

  // VLR commonly returns strings such as "10h 36m from now".
  // "now" here does NOT mean the match starts now, so remove the suffix first.
  text = text.replace(/\s+from\s+now\s*$/i, "").trim();

  // Only these exact standalone states mean immediate start.
  if (/^(live|now|starting|starting now)$/i.test(text)) return 0;

  let seconds = 0;
  let matched = false;

  // VLR can return values such as:
  // "10h 40m", "1d 2h", "2w 0d".
  const w = text.match(/(\d+)\s*w/);
  const d = text.match(/(\d+)\s*d/);
  const h = text.match(/(\d+)\s*h/);
  const m = text.match(/(\d+)\s*m/);
  const s = text.match(/(\d+)\s*s/);

  if (w) { seconds += Number(w[1]) * 7 * 86400; matched = true; }
  if (d) { seconds += Number(d[1]) * 86400; matched = true; }
  if (h) { seconds += Number(h[1]) * 3600; matched = true; }
  if (m) { seconds += Number(m[1]) * 60; matched = true; }
  if (s) { seconds += Number(s[1]); matched = true; }

  return matched ? seconds : Number.POSITIVE_INFINITY;
}

async function getUpcomingFromBridge(preferredBridge = DEFAULT_BRIDGE) {
  const preferred = normBase(preferredBridge);
  if (
    upcomingBridgeCache.value &&
    upcomingBridgeCache.preferred === preferred &&
    Date.now() - upcomingBridgeCache.at < 8000
  ) {
    return upcomingBridgeCache.value;
  }

  const candidates = [...new Set([
    preferred,
    ...FALLBACK_BRIDGES.map(normBase)
  ])];

  const errors = [];

  for (const base of candidates) {
    for (const path of [
      "/v2/match?q=upcoming",
      "/match?q=upcoming"
    ]) {
      try {
        const payload = await getJson(`${base}${path}`, 12000);
        const items = extractSegments(payload);
        if (items.length) {
          const value = { items, base };
          upcomingBridgeCache = { at: Date.now(), preferred, value };
          return value;
        }
      } catch (err) {
        errors.push(`${base}${path}: ${String(err?.message || err)}`);
      }
    }
  }

  throw new Error(`VLR upcoming unavailable. ${errors.join(" | ")}`);
}


async function getLocalUpcomingMatches() {
  if (localUpcomingCache.items.length && Date.now() - localUpcomingCache.at < 30000) {
    return localUpcomingCache.items;
  }

  try {
    const p = await getJson(`${LOCAL_API}/matches/upcoming`, 8000);
    const items = p?.success && Array.isArray(p.data) ? p.data : [];
    localUpcomingCache = { at: Date.now(), items };
    return items;
  } catch {
    return [];
  }
}

function normalizeLocalUpcomingLabels(item) {
  const event = String(item?.event || "").trim();
  const stage = String(item?.stage || "").trim();
  const looksLikeCompetition = text =>
    /(vct|challengers|game changers|masters|champions|valorant champions tour|ascension|league|series)/i.test(text);

  // The self-hosted scraper may expose stage/event in the opposite order
  // from the bridge. Normalize it for the compact overlay.
  if (looksLikeCompetition(stage) && !looksLikeCompetition(event)) {
    return { event: stage, stage: event };
  }
  return { event: event || stage || "VALORANT", stage: stage || "" };
}

async function buildUpcomingFromBridgeItem(item, bridgeBase) {
  const matchId = matchIdFromPage(item?.match_page);
  if (!matchId) return null;

  const details = await getLocalDetail(matchId);
  const [detail1, detail2] = alignDetailTeams(details, item?.team1 || "", item?.team2 || "");

  const [team1, team2, fetchedEventLogo] = await Promise.all([
    enrichTeam(item?.team1, item?.team1_logo || "", detail1),
    enrichTeam(item?.team2, item?.team2_logo || "", detail2),
    getEventLogo(bridgeBase, item?.match_event || details?.event || "")
  ]);
  const exactEventLogo = await getPublicEventLogo(
    details?.eventId || details?.event_id || details?.event?.id || "",
    item?.match_event || details?.event || ""
  ).catch(() => "");
  const eventLogo = pickDetailEventLogo(details) || exactEventLogo || fetchedEventLogo;

  const eta = parseEtaSeconds(item?.time_until_match);

  return {
    id: matchId,
    status: "upcoming",
    bestOf: parseBo(details?.format, null),
    event: String(item?.match_event || details?.event || "VALORANT").trim(),
    stage: String(item?.match_series || details?.stage || "").trim(),
    mapName: "",
    eventLogo: eventLogo || "",
    matchPage: item?.match_page || `https://www.vlr.gg/${matchId}`,
    seriesScore: [0, 0],
    roundScore: [null, null],
    teams: [team1, team2],
    etaText: String(item?.time_until_match || "").replace(/\s+from now$/i, "").trim(),
    etaSeconds: Number.isFinite(eta) ? eta : null,
    etaCapturedAt: Date.now(),
    matchTime: String(item?.match_time || "").trim(),
    sourceDebug: {
      pinned: true,
      upcomingBridge: bridgeBase,
      localDetails: Boolean(details),
      team1Profile: team1.metadataResolved,
      team2Profile: team2.metadataResolved
    }
  };
}

async function buildUpcomingFromLocalItem(item, preferredBridge) {
  const matchId = String(item?.id || "");
  if (!matchId) return null;

  const details = await getLocalDetail(matchId);
  const [detail1, detail2] = alignDetailTeams(
    details,
    item?.team1?.name || "",
    item?.team2?.name || ""
  );

  const [team1, team2] = await Promise.all([
    enrichTeam(item?.team1?.name, item?.team1?.logo || "", detail1),
    enrichTeam(item?.team2?.name, item?.team2?.logo || "", detail2)
  ]);

  const labels = normalizeLocalUpcomingLabels(item);
  const exactEventLogo = await getPublicEventLogo(
    details?.eventId || details?.event_id || details?.event?.id || "",
    labels.event
  ).catch(() => "");
  const eventLogo =
    absUrl(item?.eventLogo || "") ||
    pickDetailEventLogo(details) ||
    exactEventLogo ||
    await getEventLogo(preferredBridge, labels.event);

  const eta = parseEtaSeconds(item?.eta);

  return {
    id: matchId,
    status: "upcoming",
    bestOf: parseBo(details?.format, null),
    event: labels.event,
    stage: labels.stage,
    mapName: "",
    eventLogo,
    matchPage: `https://www.vlr.gg/${matchId}`,
    seriesScore: [0, 0],
    roundScore: [null, null],
    teams: [team1, team2],
    etaText: String(item?.eta || "").replace(/\s+from now$/i, "").trim(),
    etaSeconds: Number.isFinite(eta) ? eta : null,
    etaCapturedAt: Date.now(),
    matchTime: String(item?.matchTime || "").trim(),
    sourceDebug: {
      pinned: true,
      localUpcoming: true,
      localDetails: Boolean(details),
      team1Profile: team1.metadataResolved,
      team2Profile: team2.metadataResolved
    }
  };
}

async function getPinnedMatch(matchId, preferredBridge = DEFAULT_BRIDGE) {
  const id = parseVlrMatchId(matchId);
  if (!id) return null;

  // Direct VLR match page is the source of truth for a pasted Match ID.
  // This fixes old completed matches that third-party APIs still report as TBD/upcoming.
  const directPage = await getVlrMatchPage(id);
  const publicExact = await getPublicExactMatch(id);
  const hosted = await getHostedMatchDetail(id, preferredBridge);
  const hostedLocal = hosted?.detail ? hostedDetailToLocal(hosted.detail) : null;

  const mergedExact = mergeExactDetails(directPage, publicExact, hostedLocal);
  if (mergedExact) {
    // A score/final state from the real VLR page always wins over stale providers.
    const directStatus = directPage?.status || "";
    if (directStatus === "completed" || directStatus === "running") {
      mergedExact.status = directStatus;
      if (directPage?.team1 && hasNumericValue(directPage.team1.score)) mergedExact.team1.score = Number(directPage.team1.score);
      if (directPage?.team2 && hasNumericValue(directPage.team2.score)) mergedExact.team2.score = Number(directPage.team2.score);
      if (directPage?.eventLogo) mergedExact.eventLogo = directPage.eventLogo;

      if (directStatus === "completed") {
        const hasResolvedScore = hasNumericValue(mergedExact?.team1?.score) && hasNumericValue(mergedExact?.team2?.score)
          && (Number(mergedExact.team1.score) + Number(mergedExact.team2.score) > 0);
        if (!hasResolvedScore && mergedExact?.eventId) {
          const eventResult = await getPublicEventMatchResult(mergedExact.eventId, id);
          if (eventResult) {
            const repaired = mergeExactDetails(eventResult, mergedExact);
            repaired.status = "completed";
            return await buildExactMatchFromDetails(id, repaired, preferredBridge);
          }
        }
        if (!hasResolvedScore) {
          // Do not publish an impossible FINAL 0-0. Continue to results fallbacks below.
        } else {
          return await buildExactMatchFromDetails(id, mergedExact, preferredBridge);
        }
      } else {
        return await buildExactMatchFromDetails(id, mergedExact, preferredBridge);
      }
    }

    const inferred = inferDetailStatus(mergedExact);
    if (inferred === "completed" || inferred === "running") {
      mergedExact.status = inferred;
      return await buildExactMatchFromDetails(id, mergedExact, preferredBridge);
    }
  }

  // Results feed fallback for providers/pages that omit a final marker.
  const resultHit = await findMatchInResults(id, preferredBridge);
  if (resultHit?.item) {
    const completed = await buildCompletedFromResultItem(
      resultHit.item,
      resultHit.base || preferredBridge,
      mergedExact
    );
    if (completed) {
      if (directPage?.eventLogo) completed.eventLogo = directPage.eventLogo;
      else if (mergedExact?.eventLogo) completed.eventLogo = mergedExact.eventLogo;
      return completed;
    }
  }

  // Exact event-page fallback: useful for older completed matches outside the recent results pages.
  if (mergedExact?.eventId) {
    const eventResult = await getPublicEventMatchResult(mergedExact.eventId, id);
    if (eventResult) {
      const repaired = mergeExactDetails(eventResult, mergedExact);
      repaired.status = "completed";
      return await buildExactMatchFromDetails(id, repaired, preferredBridge);
    }
  }

  // Future match: use upcoming feed for accurate countdown while retaining exact event metadata.
  try {
    const upcoming = await getUpcomingFromBridge(preferredBridge);
    const item = upcoming.items.find(seg => matchIdFromPage(seg?.match_page) === id);
    if (item) {
      const result = await buildUpcomingFromBridgeItem(item, upcoming.base);
      const exactMeta = mergedExact || directPage;
      if (exactMeta) {
        if (exactMeta?.event) result.event = exactMeta.event;
        if (exactMeta?.stage) result.stage = exactMeta.stage;
        if (exactMeta?.eventLogo) result.eventLogo = exactMeta.eventLogo;
      }
      return result;
    }
  } catch {}

  const localUpcoming = await getLocalUpcomingMatches();
  const localItem = localUpcoming.find(item => String(item?.id || "") === id);
  if (localItem) {
    const result = await buildUpcomingFromLocalItem(localItem, preferredBridge);
    if (mergedExact?.eventLogo) result.eventLogo = mergedExact.eventLogo;
    return result;
  }

  // Last fallback: exact metadata, even if the source did not expose an ETA.
  if (mergedExact) return await buildExactMatchFromDetails(id, mergedExact, preferredBridge);
  return null;
}

async function getNearestUpcoming(preferredBridge = DEFAULT_BRIDGE) {
  let upcoming;
  try {
    upcoming = await getUpcomingFromBridge(preferredBridge);
  } catch {
    return null;
  }

  const items = upcoming.items;
  if (!items.length) return null;

  const ranked = items
    .map((item, index) => ({
      item,
      index,
      etaSeconds: parseEtaSeconds(item?.time_until_match)
    }))
    .filter(x => Number.isFinite(x.etaSeconds) && x.etaSeconds >= 0)
    .sort((a, b) => {
      if (a.etaSeconds !== b.etaSeconds) return a.etaSeconds - b.etaSeconds;
      return a.index - b.index;
    });

  const selected = ranked[0] || {
    item: items[0],
    index: 0,
    etaSeconds: parseEtaSeconds(items[0]?.time_until_match)
  };

  return selected?.item
    ? await buildUpcomingFromBridgeItem(selected.item, upcoming.base)
    : null;
}

async function getRunningMatches(preferredBridge = DEFAULT_BRIDGE) {
  const live = await getLiveScore(preferredBridge);
  const localApiReady = await localHealth();

  const segments = extractSegments(live.payload)
    .filter(seg => String(seg?.time_until_match || "").toUpperCase().includes("LIVE"));

  const out = [];

  for (const seg of segments) {
    const matchId = matchIdFromPage(seg.match_page);
    const details = localApiReady ? await getLocalDetail(matchId) : null;
    const [detail1, detail2] = alignDetailTeams(details, seg.team1, seg.team2);

    const [team1, team2, fetchedEventLogo] = await Promise.all([
      enrichTeam(seg.team1, seg.team1_logo, detail1),
      enrichTeam(seg.team2, seg.team2_logo, detail2),
      getEventLogo(live.base, seg.match_event || details?.event || "")
    ]);
    const exactEventLogo = await getPublicEventLogo(
      details?.eventId || details?.event_id || details?.event?.id || "",
      seg.match_event || details?.event || ""
    ).catch(() => "");
    const eventLogo = pickDetailEventLogo(details) || exactEventLogo || fetchedEventLogo;

    const series1 = toNum(seg.score1);
    const series2 = toNum(seg.score2);
    const mapNo = toNum(seg.map_number, 0) || (series1 + series2 + 1);

    const liveMap = usableMap(seg.current_map);
    const detailMap = usableMap(details?.maps?.[mapNo - 1]?.map);
    const currentMap = liveMap || detailMap || "";

    out.push({
      id: matchId || seg.match_page || `${seg.team1}-${seg.team2}`,
      status: "running",
      bestOf: parseBo(details?.format, 3),
      event: seg.match_event || details?.event || "VALORANT",
      stage: seg.match_series || details?.stage || "",
      mapName: currentMap
        ? `${currentMap} · Map ${mapNo}`
        : `Map ${mapNo}`,
      eventLogo,
      matchPage: seg.match_page || "",
      seriesScore: [series1, series2],
      roundScore: [
        toNum(seg.team1_round_ct) + toNum(seg.team1_round_t),
        toNum(seg.team2_round_ct) + toNum(seg.team2_round_t)
      ],
      teams: [team1, team2],
      sourceDebug: {
        liveBridge: live.base,
        localApiReady,
        localDetails: Boolean(details),
        team1Profile: team1.metadataResolved,
        team2Profile: team2.metadataResolved,
        rawCurrentMap: String(seg.current_map || "")
      }
    });
  }

  return out;
}

module.exports = {
  getRunningMatches,
  getNearestUpcoming,
  getPinnedMatch,
  parseVlrMatchId,
  DEFAULT_BRIDGE,
  LOCAL_API
};
