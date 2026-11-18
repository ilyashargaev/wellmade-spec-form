// Electrical step: Next walks through plan layers the client has not seen yet; chips still switch freely (2026-11-17).
// node tests/layers.js "<Build - Pilot>" "<scratch out folder>" (headless Chrome, file://, 390 px; screenshots go to the out folder)
const path=require('path'),fs=require('fs');const BP=process.argv[2],OUT=process.argv[3];const {launch,sleep,fileUrl}=require(path.join(BP,'tests','cdp.js'));
const HELP=fs.readFileSync(path.join(BP,'tests','helpers.js'),'utf8');
(async()=>{let bad=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)bad++;};
const b=await launch(path.join(OUT,'ly2'),9472);
const shot=async n=>{await sleep(250);const r=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,'layers-'+n+'.png'),Buffer.from(r.result.data,'base64'));};
const nextTxt='document.querySelector(".bar [data-action=next]").textContent';
const active='document.querySelector(".layer-chip[aria-pressed=true]").dataset.qid';
const seen='[...document.querySelectorAll(".layer-chip.seen")].map(c=>c.dataset.qid).join(",")';
await b.nav(fileUrl(path.join(BP,'index.html'))+'#id=LayerTest0000001&name=Layer%20Test&address=1%20Test%20St');await sleep(1200);await b.ev('localStorage.clear();true');await b.reload();await sleep(1000);await b.ev(HELP);
await b.ev('T.go("electrical")');await sleep(300);await b.ev(HELP);
await b.ev('window.scrollTo(0,0);true');await sleep(300);
// 2026-11-18: with one Comments field the plan can already be on screen at the top (then the breaker counts as seen).
const planOnTop=await b.ev('(()=>{const r=document.getElementById("plan-electrical").getBoundingClientRect();return r.top<innerHeight-80})()');
ok(await b.ev(nextTxt)===(planOnTop?'Next: Exterior outlets':'Next: Breaker box'),'A at the top (plan on screen: '+planOnTop+'): '+await b.ev(nextTxt)+' | seen '+await b.ev(seen));await shot('1-start');
if(!planOnTop){await b.ev('document.querySelector(".bar [data-action=next]").click();true');await sleep(400);}
ok(await b.ev(active)==='breaker'&&await b.ev(nextTxt)==='Next: Exterior outlets','A2 Next scrolls to the plan, breaker layer; label '+await b.ev(nextTxt));await shot('1b-breaker');
ok(await b.ev('innerWidth')===390&&await b.ev('document.documentElement.scrollWidth')<=390,'390 no h-scroll');
const bw=await b.ev('JSON.stringify([...document.querySelectorAll(".bar .wm-btn")].map(x=>[x.textContent,Math.round(x.getBoundingClientRect().height),x.scrollWidth<=x.clientWidth]))');console.log('bar',bw);
await b.ev('document.querySelector(".bar [data-action=next]").click();true');await sleep(300);
ok(await b.ev(active)==='exterior'&&await b.ev("document.getElementById('step-title').textContent")==='Electrical','B Next opens exterior layer, stays on Electrical');
ok(await b.ev(nextTxt)==='Next: Interior outlets','B label now '+await b.ev(nextTxt));await shot('2-after-next');
await b.ev('document.querySelector(".bar [data-action=next]").click();true');await sleep(300);
ok(await b.ev(active)==='interior'&&await b.ev(nextTxt)==='Next','C Next opens interior, label plain Next');
await b.ev('T.layer("exterior")');await sleep(150);ok(await b.ev(active)==='exterior'&&await b.ev(nextTxt)==='Next','D chips still switch freely, Next stays plain');
await b.ev('document.querySelector(".bar [data-action=next]").click();true');await sleep(400);
ok(await b.ev("document.getElementById('step-title').textContent")==='Review','E then Next goes to Review (v2: Electrical is the last step before Review)');
// client who clicks layers himself
await b.ev('localStorage.clear();true');await b.reload();await sleep(1000);await b.ev(HELP);await b.ev('T.go("electrical")');await sleep(300);await b.ev(HELP);
await b.ev('window.scrollTo(0,0);true');await sleep(200);await b.ev('T.layer("interior")');await sleep(150);ok(['Next: Breaker box','Next: Exterior outlets'].includes(await b.ev(nextTxt)),'F opened interior himself: Next still walks the unseen layers -> '+await b.ev(nextTxt));
await b.ev('T.layer("exterior")');await sleep(150);await b.ev('T.layer("breaker")');await sleep(150);ok(await b.ev(nextTxt)==='Next','G all opened by chips: plain Next');
await b.ev('localStorage.clear();true');await b.reload();await sleep(1000);await b.ev(HELP);await b.ev('T.go("electrical")');await sleep(300);await b.ev(HELP);
await b.ev('document.getElementById("plan-electrical").scrollIntoView();true');await sleep(400);ok(await b.ev(nextTxt)==='Next: Exterior outlets','H scrolled to the plan himself: breaker counts as seen');
ok(b.exceptions().length===0,'no page errors '+JSON.stringify(b.exceptions()));b.close();console.log(bad?bad+' FAILED':'ALL PASS');})();
