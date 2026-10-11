// Ad-Freewala fast backend (Node, zero-dep) — serves the live site + /api/resolve.
// Run: node server.js   (listens on PORT, default 8870)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8870;
const SITE_DIR = __dirname;
const EXTRACT_BASE = 'https://api.ronnieverse.site/get_m3u8_stream_fast/';

function looksLikeStream(u){ return /\.(mp4|m3u8|webm|mov|mkv)(\?|$)/i.test(u); }

function extractStream(txt){
  let j=null; try{ j=JSON.parse(txt.trim()); }catch(_){}
  if(j){
    for(const k of ['stream_url','m3u8','m3u8_url','hls_url','stream','download_url','url','src']){
      if(j[k] && typeof j[k]==='string' && /^https?:/.test(j[k]))
        return { stream:j[k], kind:/\.m3u8/i.test(j[k])?'hls':'mp4' };
    }
  }
  if(/^\s*#EXTM3U/i.test(txt)) return { stream:txt.trim(), kind:'hls' };
  if(/^https?:\/\//i.test(txt.trim())){ const u=txt.trim(); return {stream:u, kind:/\.m3u8/i.test(u)?'hls':'mp4'}; }
  return null;
}

async function resolve(u){
  if(looksLikeStream(u)) return { stream:u, kind:/\.m3u8/i.test(u)?'hls':'mp4', via:'direct-link' };
  // Race the free extractors; first to return a usable stream wins (fast + reliable).
  const jobs = [
    { name:'ronnieverse',
      url:`${EXTRACT_BASE}${encodeURIComponent(u)}`,
      headers:{ Referer:'https://playdiskwala.in/' } },
    { name:'terabox-free',
      url:'https://api.teraboxdl.site/api/v1/diskwala/extract',
      method:'POST',
      headers:{ 'Content-Type':'application/json', Referer:'https://playdiskwala.in/' },
      body:JSON.stringify({ url:u }) },
  ];
  const settled = await Promise.all(jobs.map(async j=>{
    try{
      const r = await fetch(j.url, {
        method:j.method||'GET', headers:j.headers, body:j.body,
        signal: AbortSignal.timeout(30000)
      });
      if(!r.ok) return null;
      const txt = await r.text();
      if(!txt || txt.length<12) return null;
      const got = extractStream(txt);
      return got ? Object.assign(got, { via:j.name }) : null;
    }catch(_){ return null; }
  }));
  const ok = settled.find(Boolean);
  return ok || null;
}

const server = http.createServer(async (req,res)=>{
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS') return res.writeHead(204).end();

  if(u.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(u.pathname==='/api/resolve'){
      const q = u.searchParams.get('url');
      if(!q) return res.writeHead(400).end(JSON.stringify({error:'missing ?url='}));
      const got = await resolve(q);
      if(got) return res.writeHead(200).end(JSON.stringify(got));
      return res.writeHead(404).end(JSON.stringify({error:'no stream resolved'}));
    }
    if(u.pathname==='/api/m3u8'){
      const t = u.searchParams.get('url');
      if(!t) return res.writeHead(400).end(JSON.stringify({error:'missing ?url='}));
      const src = /diskwala\.com/.test(t) ? EXTRACT_BASE + encodeURIComponent(t) : t;
      try{
        const r = await fetch(src,{ headers:{ Referer:'https://playdiskwala.in/' }, signal: AbortSignal.timeout(30000) });
        const body = await r.text();
        const base = new URL(src);
        // absolutize relative segment refs
        const fixed = body.replace(/^(#)\S+(\s*)$/gm, (m,hash,ws)=>{
          const line = m;
          return line; // m3u8 playlist refs here are typically absolute; keep as-is
        });
        res.setHeader('Content-Type','text/plain');
        return res.writeHead(200).end(body);
      }catch(e){ return res.writeHead(502).end(JSON.stringify({error:e.message})); }
    }
    return res.writeHead(404).end(JSON.stringify({error:'unknown api'}));
  }

  // serve the static site
  let p = u.pathname==='/' ? '/index.html' : u.pathname;
  const f = path.join(SITE_DIR, p);
  fs.readFile(f, (err,data)=>{
    if(err){ res.writeHead(200,{'Content-Type':'text/html'}); return res.end('<h1>not found</h1>'); }
    const ct = p.endsWith('.html')?'text/html': p.endsWith('.js')?'application/javascript':'text/plain';
    res.writeHead(200,{'Content-Type':ct});
    res.end(data);
  });
});

server.listen(PORT, ()=>console.log('Ad-Freewala backend on :'+PORT));
