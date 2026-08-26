const DEFAULT_BRIDGE = process.env.VLR_LIVE_BRIDGE || "https://vctgemini.vercel.app";
const FALLBACK_BRIDGES = [
  "https://vctgemini.vercel.app",
  "https://vlrggapi.vercel.app"
];

const LOCAL_API = process.env.VLR_LOCAL_API || "http://127.0.0.1:3002/api";

const profileCache = new Map();
const detailCache = new Map();
const eventLogoCache = new Map();
let eventsCache = { at: 0, items: [] };

function normBase(value) {
  return String(value || "").replace(/\/+$/, "");
}

function absUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  return s;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function extractSegments(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.segments)) return payload.segments;
  if (Array.isArray(payload?.data?.segments)) return payload.data.segments;
  if (Array.isArray(payload?.data?.data?.segments)) return payload.data.data.segments;
  return [];
}

async function getJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ValorantLiveOverlay/4.0-hosted"
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

  const logo = bestScore >= 0.30
    ? absUrl(best?.thumb || best?.logo || best?.image || "")
    : "";

  eventLogoCache.set(key, { at: Date.now(), logo });
  return logo;
}

async function enrichTeam(liveName, liveLogo, detailTeam) {
  const profile = detailTeam?.id ? await getLocalTeam(detailTeam.id) : null;

  // Exact VLR team profile is authoritative for tag/logo.
  const tag = String(profile?.tag || "").trim().toUpperCase();

  return {
    id: detailTeam?.id || profile?.id || null,
    name: profile?.name || detailTeam?.name || liveName || "TBD",
    acronym: tag || "",
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
  const candidates = [...new Set([
    normBase(preferredBridge),
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
        if (items.length) return { items, base };
      } catch (err) {
        errors.push(`${base}${path}: ${String(err?.message || err)}`);
      }
    }
  }

  throw new Error(`VLR upcoming unavailable. ${errors.join(" | ")}`);
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

  // Choose by VLR's own "time_until_match", not by our local scraper list.
  // This keeps "next" consistent with the VLR schedule page.
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

  const item = selected.item;
  if (!item) return null;

  const matchId = matchIdFromPage(item.match_page);
  const details = matchId ? await getLocalDetail(matchId) : null;
  const [detail1, detail2] = alignDetailTeams(
    details,
    item?.team1 || "",
    item?.team2 || ""
  );

  const [team1, team2, eventLogo] = await Promise.all([
    enrichTeam(item?.team1, "", detail1),
    enrichTeam(item?.team2, "", detail2),
    getEventLogo(upcoming.base, item?.match_event || details?.event || "")
  ]);

  const etaSeconds = Number.isFinite(selected.etaSeconds)
    ? selected.etaSeconds
    : null;

  return {
    id: matchId || `upcoming-${Date.now()}`,
    status: "upcoming",
    bestOf: parseBo(details?.format, null),
    event: String(item?.match_event || details?.event || "VALORANT").trim(),
    stage: String(item?.match_series || details?.stage || "").trim(),
    mapName: "",
    eventLogo: eventLogo || "",
    matchPage: item?.match_page || (matchId ? `https://www.vlr.gg/${matchId}` : ""),
    seriesScore: [0, 0],
    roundScore: [null, null],
    teams: [team1, team2],
    etaText: String(item?.time_until_match || "").replace(/\s+from now$/i, "").trim(),
    etaSeconds,
    etaCapturedAt: Date.now(),
    sourceDebug: {
      upcomingBridge: upcoming.base,
      localApiReady: await localHealth(),
      localDetails: Boolean(details),
      team1Profile: team1.metadataResolved,
      team2Profile: team2.metadataResolved,
      upcoming: true
    }
  };
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

    const [team1, team2, eventLogo] = await Promise.all([
      enrichTeam(seg.team1, seg.team1_logo, detail1),
      enrichTeam(seg.team2, seg.team2_logo, detail2),
      getEventLogo(live.base, seg.match_event || details?.event || "")
    ]);

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
  DEFAULT_BRIDGE,
  LOCAL_API
};
