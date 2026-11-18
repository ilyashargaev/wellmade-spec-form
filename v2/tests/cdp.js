// Minimal CDP driver for headless Chrome (Node 22+, global WebSocket/fetch).
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function launch(profile, port, size){
  size = size || {width:390,height:844,mobile:true};
  const p = spawn(CHROME, ['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
  let list;
  for (let i=0;i<50;i++){ try{ list = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(); if(list.find(t=>t.type==='page')) break;}catch(e){} await sleep(200); }
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const pend={}; const events=[];
  ws.addEventListener('message', m=>{ const d=JSON.parse(m.data); if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id];} else events.push(d); });
  const send=(method,params={})=>new Promise(r=>{ const i=++id; pend[i]=r; ws.send(JSON.stringify({id:i,method,params})); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:size.mobile?2:1,mobile:!!size.mobile});
  async function ev(expr){ const r = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(r.result.exceptionDetails) throw new Error('eval: '+JSON.stringify(r.result.exceptionDetails).slice(0,500)); return r.result.result.value; }
  async function nav(url){ events.length=0; await send('Page.navigate',{url}); await sleep(1200); }
  async function reload(){ await send('Page.reload',{}); await sleep(1200); }
  async function shot(file, clip){ const r=await send('Page.captureScreenshot',clip?{format:'png',clip:Object.assign({scale:1},clip)}:{format:'png'}); fs.writeFileSync(file, Buffer.from(r.result.data,'base64')); }
  function exceptions(){ /* page errors since the last nav */ return events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description : e.params.exceptionDetails.text); }
  function close(){ try{ws.close();}catch(e){} p.kill(); }
  return { send, ev, nav, reload, shot, exceptions, close, events };
}
function fileUrl(p){ return 'file:///' + p.split(String.fromCharCode(92)).join('/').split('/').map(encodeURIComponent).join('/').replace(/^G%3A/,'G:'); }
module.exports = { launch, fileUrl, sleep };
