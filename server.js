const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
let getDemoMatches = async () => [];
try {
  ({ getRunningMatches: getDemoMatches } = require("./providers/demo"));
} catch (err) {
  console.warn("[startup] providers/demo.js not found; DEMO_MODE disabled.");
}
const { getRunningMatches: getVlrMatches, getNearestUpcoming, getPinnedMatch, parseVlrMatchId, DEFAULT_BRIDGE } = require("./providers/vlr_local");

const PORT = Number(process.env.PORT || 8787);
const POLL_MS = Math.max(8000, Number(process.env.POLL_MS || 10000));
const publicDir = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");
const DEFAULT_ROOM_TTL_DAYS = Math.max(1, Number(process.env.ROOM_TTL_DAYS || 30));
const MAX_ROOMS = Math.max(10, Number(process.env.MAX_ROOMS || 1000));
const OBS_RECOMMENDED = Object.freeze({ width:500, height:160, fps:30 });
const USE_DEMO = process.env.DEMO_MODE === "1" && typeof getDemoMatches === "function";
const vlrApiBase = String(process.env.VLR_LIVE_BRIDGE || DEFAULT_BRIDGE).replace(/\/+$/, "");

fs.mkdirSync(DATA_DIR, { recursive: true });

let matches = [];
let nearestUpcoming = null;
let pinnedMatches = new Map();
let providerError = "";
let activeBridge = "";
let rooms = loadRooms();
const roomClients = new Map();

const teamColors = {
  "PRX":"#ff4f87","SEN":"#d62839","G2":"#e7e7ea","FNC":"#ff5a1f",
  "KRU":"#ff4fa3","LEV":"#42b7ff","NRG":"#ff5b47","LOUD":"#67d14f",
  "MIBR":"#f0b24a","100T":"#d8393e","GEN":"#c8a34e","T1":"#e5313d",
  "DRX":"#6c5cff","GE":"#2f7cff","VL":"#1f87ff","NS":"#e64242","TL":"#7ea7ff","KRX":"#53e4ef"
};

function nowIso(){ return new Date().toISOString(); }
function roomId(){ return crypto.randomBytes(5).toString("base64url").toUpperCase(); }
function adminKey(){ return crypto.randomBytes(24).toString("base64url"); }

function defaultSettings(){
  return { backgroundOpacity:0.92, glowIntensity:0.82 };
}
function emptyManual(){
  return { round1:null, round2:null, map1:null, map2:null, mapName:null };
}
function normalizeRoom(room){
  return {
    id:String(room.id || roomId()),
    adminKey:String(room.adminKey || adminKey()),
    name:String(room.name || "My Overlay").slice(0,60),
    selectedId:room.selectedId ? String(room.selectedId) : null,
    autoSelect:room.autoSelect !== false,
    sourceMode:(room.sourceMode === "pinned" && room.pinnedMatchId) ? "pinned" : "automatic",
    pinnedMatchId:room.pinnedMatchId ? String(room.pinnedMatchId) : null,
    pinnedMatchPage:room.pinnedMatchId
      ? `https://www.vlr.gg/${String(room.pinnedMatchId)}`
      : null,
    settings:{
      backgroundOpacity:Number(room.settings?.backgroundOpacity ?? 0.92),
      glowIntensity:Number(room.settings?.glowIntensity ?? 0.82)
    },
    manual:{ ...emptyManual(), ...(room.manual || {}) },
    createdAt:room.createdAt || nowIso(),
    updatedAt:room.updatedAt || nowIso()
  };
}
function loadRooms(){
  try{
    const raw=JSON.parse(fs.readFileSync(ROOMS_FILE,"utf8"));
    const list=Array.isArray(raw?.rooms) ? raw.rooms : [];
    const out=new Map();
    for(const r of list){ const n=normalizeRoom(r); out.set(n.id,n); }
    return out;
  }catch{ return new Map(); }
}
function saveRooms(){
  const tmp=ROOMS_FILE+".tmp";
  fs.writeFileSync(tmp,JSON.stringify({version:1,rooms:[...rooms.values()]},null,2),"utf8");
  fs.renameSync(tmp,ROOMS_FILE);
}
function touchRoom(room){ room.updatedAt=nowIso(); }
function pruneRooms(){
  const cutoff=Date.now()-DEFAULT_ROOM_TTL_DAYS*86400000;
  let changed=false;
  for(const [id,r] of rooms){
    if(Date.parse(r.updatedAt || r.createdAt || 0) < cutoff){ rooms.delete(id); changed=true; }
  }
  if(changed) saveRooms();
}

function json(res,status,body){
  const data=JSON.stringify(body);
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(data),"Cache-Control":"no-store","Access-Control-Allow-Origin":"*"});
  res.end(data);
}
function text(res,status,body,type="text/plain; charset=utf-8"){
  res.writeHead(status,{"Content-Type":type,"Content-Length":Buffer.byteLength(body),"Cache-Control":"no-store"});res.end(body);
}
function serveFile(res,filename,contentType){
  try{const body=fs.readFileSync(path.join(publicDir,filename));res.writeHead(200,{"Content-Type":contentType,"Cache-Control":"no-store"});res.end(body)}catch{text(res,404,"Not found")}
}
function readJsonBody(req){
  return new Promise((resolve,reject)=>{let raw="";req.on("data",c=>{raw+=c;if(raw.length>65536)reject(new Error("Body too large"))});req.on("end",()=>{if(!raw)return resolve({});try{resolve(JSON.parse(raw))}catch{reject(new Error("Invalid JSON"))}});req.on("error",reject)});
}

function cleanTeamLabel(value){
  return String(value||"")
    .replace(/^(?:next|upcoming|live|final|featured)\s*[:·\-|]+\s*/i, "")
    .replace(/^(?:match|series)\s*[:·\-|]+\s*/i, "")
    .trim();
}
function safeCode(team){
  const raw=cleanTeamLabel(team?.acronym||"").trim().toUpperCase();
  if(raw) return raw.slice(0,4);
  const name=cleanTeamLabel(team?.name||"TBD").replace(/[^A-Za-z0-9 ]/g," ").trim();
  const words=name.split(/\s+/).filter(Boolean);
  if(words.length>=2) return words.map(w=>w[0]).join("").slice(0,4).toUpperCase();
  return (name.slice(0,4)||"TBD").toUpperCase();
}
function hashColor(seed){let h=0;for(const ch of String(seed||"team"))h=(h*31+ch.charCodeAt(0))>>>0;return `hsl(${h%360} 72% 58%)`}
function colorFor(team){return teamColors[safeCode(team)]||hashColor(safeCode(team))}
function priorityScore(match){
  const s=`${match.event||""} ${match.stage||""}`.toLowerCase();let score=500;
  if(s.includes("champions"))score+=1000;if(s.includes("masters"))score+=900;
  if(s.includes("vct")||s.includes("champions tour"))score+=800;
  if(s.includes("game changers"))score+=550;if(s.includes("challengers")||s.includes("vcl"))score+=450;
  if(s.includes("grand final"))score+=220;else if(s.includes("final"))score+=160;if(s.includes("playoff"))score+=120;return score;
}
function rankMatches(list){return [...list].sort((a,b)=>priorityScore(b)-priorityScore(a))}

function getRoom(id){ return rooms.get(String(id||"")) || null; }
function requestKey(req,url){ return req.headers["x-admin-key"] || url.searchParams.get("key") || ""; }
function canWrite(room,req,url){ return room && crypto.timingSafeEqual(Buffer.from(String(room.adminKey)),Buffer.from(String(requestKey(req,url)))) }
function requireRoom(res,id){ const room=getRoom(id); if(!room) json(res,404,{error:"Room not found"}); return room; }
function requireWrite(res,room,req,url){
  const a=Buffer.from(String(room?.adminKey||"")); const b=Buffer.from(String(requestKey(req,url)||""));
  if(!room || a.length!==b.length || !crypto.timingSafeEqual(a,b)){ json(res,403,{error:"Invalid admin key"}); return false; }
  return true;
}

function resolveRoomMatch(room){
  if(room.sourceMode==="pinned" && room.pinnedMatchId){
    const id=String(room.pinnedMatchId);
    const live=matches.find(m=>String(m.id)===id);
    return live || pinnedMatches.get(id) || null;
  }

  if(!matches.length) return nearestUpcoming;
  if(room.selectedId){
    const selected=matches.find(m=>String(m.id)===String(room.selectedId));
    if(selected) return selected;
  }
  return room.autoSelect ? matches[0] : (nearestUpcoming || matches[0]);
}
function composeRoomState(room){
  const match=resolveRoomMatch(room);
  if(!match){
    const pinned=room.sourceMode==="pinned" && room.pinnedMatchId;
    return {
      connected:true,
      provider:USE_DEMO?"demo":"vlr",
      providerError,
      status:"waiting",
      message:pinned?"Pinned match is temporarily unavailable":"No live/upcoming match detected",
      ui:room.settings,
      roomId:room.id,
      sourceMode:room.sourceMode,
      pinnedMatchId:room.pinnedMatchId||null
    }
  }
  const t1=match.teams?.[0]||{name:"TBD"}; const t2=match.teams?.[1]||{name:"TBD"};
  const isUpcoming=match.status==="upcoming"; const manual=room.manual||emptyManual();
  return {
    connected:true,provider:USE_DEMO?"demo":"vlr",providerError,status:match.status||"running",roomId:room.id,
    sourceMode:room.sourceMode,pinnedMatchId:room.pinnedMatchId||null,
    matchId:String(match.id),matchPage:match.matchPage||"",bestOf:match.bestOf||null,event:match.event||"VALORANT",stage:match.stage||"",
    mapName:manual.mapName??match.mapName??"",eventLogo:match.eventLogo||"",ui:room.settings,
    team1:{id:t1.id,name:t1.name,code:safeCode(t1),logo:t1.logo||"",color:colorFor(t1),series:isUpcoming?0:(manual.map1??Number(match.seriesScore?.[0]??0)),rounds:isUpcoming?null:(manual.round1??match.roundScore?.[0]??null)},
    team2:{id:t2.id,name:t2.name,code:safeCode(t2),logo:t2.logo||"",color:colorFor(t2),series:isUpcoming?0:(manual.map2??Number(match.seriesScore?.[1]??0)),rounds:isUpcoming?null:(manual.round2??match.roundScore?.[1]??null)},
    etaText:isUpcoming?(match.etaText||""):"",etaSeconds:isUpcoming?match.etaSeconds:null,etaCapturedAt:isUpcoming?match.etaCapturedAt:null,matchTime:isUpcoming?(match.matchTime||""):"",updatedAt:nowIso()
  };
}
function clientsFor(roomId){ if(!roomClients.has(roomId))roomClients.set(roomId,new Set());return roomClients.get(roomId) }
function broadcastRoom(room){
  const payload=`event: state\ndata: ${JSON.stringify(composeRoomState(room))}\n\n`;
  for(const res of clientsFor(room.id)){try{res.write(payload)}catch{}}
}
function broadcastAll(){for(const room of rooms.values())broadcastRoom(room)}

async function refreshMatches(){
  try{
    providerError="";
    matches=USE_DEMO?await getDemoMatches():await getVlrMatches(vlrApiBase);
    activeBridge=USE_DEMO?"":(matches.find(m=>m.sourceDebug?.liveBridge)?.sourceDebug?.liveBridge||vlrApiBase);
    matches=rankMatches(matches);
    nearestUpcoming=(!USE_DEMO&&matches.length===0)?await getNearestUpcoming(vlrApiBase):null;

    const nextPinned=new Map();
    const pinnedIds=[...new Set(
      [...rooms.values()]
        .filter(r=>r.sourceMode==="pinned" && r.pinnedMatchId)
        .map(r=>String(r.pinnedMatchId))
    )];

    for(const id of pinnedIds){
      const live=matches.find(m=>String(m.id)===id);
      if(live){
        nextPinned.set(id,live);
        continue;
      }
      try{
        const resolved=await getPinnedMatch(id,vlrApiBase);
        if(resolved) nextPinned.set(id,resolved);
      }catch(err){
        console.warn(`[pinned] ${id}: ${String(err?.message||err)}`);
        const old=pinnedMatches.get(id);
        if(old) nextPinned.set(id,old);
      }
    }
    pinnedMatches=nextPinned;

    for(const room of rooms.values()){
      if(room.sourceMode!=="pinned" && room.selectedId && !matches.some(m=>String(m.id)===String(room.selectedId))){
        room.selectedId=null;
        touchRoom(room);
      }
    }
    broadcastAll();
    console.log(`[hosted] live=${matches.length} rooms=${rooms.size} bridge=${activeBridge||"demo"}`);
  }catch(err){providerError=String(err?.message||err);console.error("[hosted]",providerError);broadcastAll()}
}

function requestOrigin(req){
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  return `${proto}://${req.headers.host}`;
}

function publicRoom(room,origin){
  return {
    id:room.id,
    name:room.name,
    adminUrl:`${origin}/admin/${room.id}?key=${room.adminKey}`,
    overlayUrl:`${origin}/overlay/${room.id}`,
    createdAt:room.createdAt,
    obs:OBS_RECOMMENDED
  };
}

async function proxyImage(res,imageUrl){
  try{const upstream=await fetch(imageUrl,{headers:{"User-Agent":"VLROverlayForVCTMatches/4.9"}});if(!upstream.ok)return text(res,upstream.status,"Unable to load image");const contentType=upstream.headers.get("content-type")||"image/png";const buffer=Buffer.from(await upstream.arrayBuffer());res.writeHead(200,{"Content-Type":contentType,"Content-Length":buffer.length,"Cache-Control":"public, max-age=900","Access-Control-Allow-Origin":"*"});res.end(buffer)}catch{text(res,500,"Image proxy error")}
}

function routeRoomApi(req,res,url,parts){
  const room=requireRoom(res,parts[2]); if(!room)return;
  const action=parts[3]||"";
  if(req.method==="GET"&&action==="state") return json(res,200,composeRoomState(room));
  if(req.method==="GET"&&action==="matches") return json(res,200,{
    provider:USE_DEMO?"demo":"vlr",
    providerError,
    liveCount:matches.length,
    selectedId:room.selectedId,
    autoSelect:room.autoSelect,
    sourceMode:room.sourceMode,
    pinnedMatchId:room.pinnedMatchId||null,
    pinnedMatch:room.pinnedMatchId ? (matches.find(m=>String(m.id)===String(room.pinnedMatchId)) || pinnedMatches.get(String(room.pinnedMatchId)) || null) : null,
    nearestUpcoming,
    matches:matches.map(m=>({...m,priority:priorityScore(m)}))
  });
  if(req.method==="GET"&&action==="info") return json(res,200,{
    id:room.id,
    name:room.name,
    settings:room.settings,
    selectedId:room.selectedId,
    autoSelect:room.autoSelect,
    sourceMode:room.sourceMode,
    pinnedMatchId:room.pinnedMatchId||null,
    pinnedMatchPage:room.pinnedMatchPage||null,
    obs:OBS_RECOMMENDED
  });
  if(req.method==="POST"&&action==="pin"){
    if(!requireWrite(res,room,req,url))return;
    return readJsonBody(req).then(async body=>{
      const raw=String(body.input||body.url||body.id||"").trim();

      // DEMO_MODE accepts its synthetic IDs so the feature can be smoke-tested.
      let id="";
      let resolved=null;
      if(USE_DEMO){
        resolved=matches.find(m=>String(m.id)===raw)||null;
        if(resolved) id=String(resolved.id);
      }

      if(!id) id=parseVlrMatchId(raw);
      if(!id) return json(res,400,{error:"Pega una URL válida de VLR.gg o un Match ID numérico."});

      if(!resolved) resolved=matches.find(m=>String(m.id)===id)||null;
      if(!resolved && !USE_DEMO) resolved=await getPinnedMatch(id,vlrApiBase);
      if(!resolved) return json(res,404,{error:"No pude encontrar esa match en VLR. Revisa el enlace o el ID."});

      room.sourceMode="pinned";
      room.pinnedMatchId=id;
      room.pinnedMatchPage=`https://www.vlr.gg/${id}`;
      room.selectedId=null;
      room.autoSelect=false;
      room.manual=emptyManual();
      pinnedMatches.set(id,resolved);
      touchRoom(room);
      saveRooms();
      broadcastRoom(room);

      return json(res,200,{ok:true,pinnedMatchId:id,match:resolved,state:composeRoomState(room)});
    }).catch(err=>json(res,400,{error:err.message}));
  }

  if(req.method==="POST"&&action==="unpin"){
    if(!requireWrite(res,room,req,url))return;
    room.sourceMode="automatic";
    room.pinnedMatchId=null;
    room.pinnedMatchPage=null;
    room.selectedId=null;
    room.autoSelect=true;
    room.manual=emptyManual();
    touchRoom(room);
    saveRooms();
    broadcastRoom(room);
    return json(res,200,{ok:true,state:composeRoomState(room)});
  }

  if(req.method==="POST"&&action==="regenerate-key"){
    if(!requireWrite(res,room,req,url))return;
    room.adminKey=adminKey();
    touchRoom(room);
    saveRooms();
    const origin=requestOrigin(req);
    return json(res,200,{
      ok:true,
      adminKey:room.adminKey,
      adminUrl:`${origin}/admin/${room.id}?key=${room.adminKey}`
    });
  }

  if(req.method==="POST"&&action==="delete"){
    if(!requireWrite(res,room,req,url))return;
    const listeners=clientsFor(room.id);
    for(const client of listeners){
      try{
        client.write(`event: deleted\ndata: ${JSON.stringify({roomId:room.id})}\n\n`);
        client.end();
      }catch{}
    }
    roomClients.delete(room.id);
    rooms.delete(room.id);
    saveRooms();
    return json(res,200,{ok:true,deleted:room.id});
  }

  if(req.method==="POST"&&["settings","select","auto","manual","manual-reset","rename"].includes(action)){
    if(!requireWrite(res,room,req,url))return;
    return readJsonBody(req).then(body=>{
      if(action==="settings"){
        if(body.backgroundOpacity!==undefined){const v=Number(body.backgroundOpacity);if(Number.isFinite(v))room.settings.backgroundOpacity=Math.max(.35,Math.min(1,v))}
        if(body.glowIntensity!==undefined){const v=Number(body.glowIntensity);if(Number.isFinite(v))room.settings.glowIntensity=Math.max(0,Math.min(1.6,v))}
      }else if(action==="select"){
        const m=matches.find(x=>String(x.id)===String(body.id));
        if(!m)return json(res,404,{error:"Match not found"});
        room.sourceMode="automatic";
        room.pinnedMatchId=null;
        room.pinnedMatchPage=null;
        room.selectedId=String(m.id);
        room.autoSelect=false;
        room.manual=emptyManual();
      }else if(action==="auto"){
        room.sourceMode="automatic";
        room.pinnedMatchId=null;
        room.pinnedMatchPage=null;
        room.autoSelect=true;
        room.selectedId=null;
        room.manual=emptyManual();
      }else if(action==="manual"){
        for(const key of ["round1","round2","map1","map2"]){if(body[key]===null)room.manual[key]=null;else if(body[key]!==undefined){const v=Number(body[key]);if(Number.isFinite(v))room.manual[key]=Math.max(0,Math.min(99,Math.floor(v)))}}
        if(body.mapName!==undefined)room.manual.mapName=String(body.mapName||"").slice(0,50);
      }else if(action==="manual-reset") room.manual=emptyManual();
      else if(action==="rename") room.name=String(body.name||"My Overlay").slice(0,60);
      touchRoom(room);saveRooms();broadcastRoom(room);return json(res,200,{ok:true,state:composeRoomState(room)});
    }).catch(err=>json(res,400,{error:err.message}));
  }
  json(res,404,{error:"Not found"});
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`); const parts=url.pathname.split("/").filter(Boolean);
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key","Access-Control-Allow-Methods":"GET,POST,OPTIONS"});return res.end()}
  if(url.pathname==="/health")return json(res,200,{ok:true,version:"4.2.0",rooms:rooms.size,live:matches.length,providerError});
  if(req.method==="GET"&&url.pathname==="/api/config")return json(res,200,{
    provider:USE_DEMO?"demo":"vlr",
    providerError,
    pollMs:POLL_MS,
    activeBridge,
    obs:OBS_RECOMMENDED
  });
  if(req.method==="POST"&&url.pathname==="/api/rooms"){
    if(rooms.size>=MAX_ROOMS) return json(res,429,{error:"Room limit reached"});
    return readJsonBody(req).then(body=>{let id=roomId();while(rooms.has(id))id=roomId();const room=normalizeRoom({id,adminKey:adminKey(),name:body.name||"My Overlay"});rooms.set(id,room);saveRooms();const origin=requestOrigin(req);json(res,201,{ok:true,room:publicRoom(room,origin)})}).catch(err=>json(res,400,{error:err.message}));
  }
  if(parts[0]==="api"&&parts[1]==="rooms"&&parts[2])return routeRoomApi(req,res,url,parts);
  if(req.method==="POST"&&url.pathname==="/api/refresh")return refreshMatches().finally(()=>json(res,200,{ok:true,providerError}));
  if(req.method==="GET"&&url.pathname==="/api/image-proxy"){const imageUrl=url.searchParams.get("url");if(!imageUrl)return json(res,400,{error:"Missing url"});return proxyImage(res,imageUrl)}
  if(parts[0]==="events"&&parts[1]){
    const room=requireRoom(res,parts[1]);if(!room)return;
    res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","Access-Control-Allow-Origin":"*"});
    res.write(`event: state\ndata: ${JSON.stringify(composeRoomState(room))}\n\n`);const set=clientsFor(room.id);set.add(res);req.on("close",()=>set.delete(res));return;
  }
  if(url.pathname==="/"||url.pathname==="/create")return serveFile(res,"landing.html","text/html; charset=utf-8");
  if(parts[0]==="admin"&&parts[1])return serveFile(res,"admin-hosted.html","text/html; charset=utf-8");
  if(parts[0]==="overlay"&&parts[1])return serveFile(res,"overlay-compact.html","text/html; charset=utf-8");
  text(res,404,"Not found");
});

pruneRooms();
refreshMatches();
setInterval(refreshMatches,POLL_MS).unref();
setInterval(pruneRooms,6*60*60*1000).unref();

server.listen(PORT,"0.0.0.0",()=>{
  console.log("VLR Overlay for VCT Matches v4.9");
  console.log(`Web: http://localhost:${PORT}/`);
  console.log(`Rooms: ${rooms.size}`);
  console.log(`Polling: ${POLL_MS/1000}s`);
});
