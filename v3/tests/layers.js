// Electrical step: Next walks through plan layers the client has not seen yet; chips still switch freely (2026-11-17).
// node tests/layers.js "<Build - Pilot>" "<scratch out folder>" (headless Chrome, file://, 390 px; screenshots go to the out folder)
const path=require('path'),fs=require('fs');const BP=process.argv[2],OUT=process.argv[3];const {launch,sleep,fileUrl}=require(path.join(BP,'tests','cdp.js'));
const HELP=fs.readFileSync(path.join(BP,'tests','helpers.js'),'utf8');const SPEC=JSON.parse(fs.readFileSync(path.join(BP,'spec','presidio-xo.json'),'utf8'));
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
// 2.5.0: the question headings now sit above the plan picture, so "on screen" = at least half of the picture (.plan-stage) is in view (the engine's IntersectionObserver threshold).
const planOnTop=await b.ev('(()=>{const r=document.querySelector("#plan-electrical .plan-stage").getBoundingClientRect();const vis=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));return vis>=r.height*0.5})()');
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
ok(await b.ev("document.getElementById('step-title').textContent")==='Permits','E then Next goes to Permits (2.5.0 order: Finishes, Add-ons, Electrical, Permits, Review)');
// 2.5.0 plan layout: headings above the plan, numbered chips, only the active layer's markers drawn.
await b.ev('T.go("electrical")');await sleep(300);await b.ev(HELP);
const lay=await b.ev(`(()=>{const box=document.getElementById("plan-electrical"),stage=box.querySelector(".plan-stage");const before=e=>!!(e.compareDocumentPosition(stage)&Node.DOCUMENT_POSITION_FOLLOWING);
 return {chips:[...box.querySelectorAll(".layer-chip")].map(c=>[c.firstElementChild.className,c.firstElementChild.textContent,c.textContent.replace(/\\d+$/,"")]),
  countShown:[...box.querySelectorAll(".layer-chip .count")].some(e=>getComputedStyle(e).display!=="none"&&e.getBoundingClientRect().width>0),
  how:(box.querySelector("p.plan-how.layer-hint")||{}).textContent,
  heads:["breaker","exterior","interior"].map(q=>{const h=document.getElementById("qh-"+q);return h&&[h.classList.contains("plan-head"),(h.querySelector(".plan-step")||{}).textContent,(h.querySelector("h3")||{}).textContent,before(h)];}),
  blocks:["breaker","exterior","interior"].map(q=>{const e=document.getElementById("q-"+q);return [!e.querySelector("h3"),e.firstElementChild.textContent,!before(e)];})};})()`);
ok(JSON.stringify(lay.chips)===JSON.stringify([['num','1','1Breaker box'],['num','2','2Exterior outlets'],['num','3','3Interior outlets']]),'chips start with a number span: '+JSON.stringify(lay.chips));
ok(!lay.countShown,'chip count badge hidden by CSS');
ok(lay.how===SPEC.plans.electrical.howTo,'line above the chips is plans.electrical.howTo');
const asks=['breaker','exterior','interior'].map(q=>SPEC.steps.find(s=>s.id==='electrical').items.find(i=>i.id===q).ask);
ok(JSON.stringify(lay.heads)===JSON.stringify(asks.map((a,i)=>[true,(i+1)+' of 3',a,true])),'plan-head per question ABOVE the plan: "N of 3" + ask: '+JSON.stringify(lay.heads));
ok(lay.blocks.every(x=>x[0]&&x[1]==='Or pick from the list:'&&x[2]),'block under the plan: no h3, starts with "Or pick from the list:" '+JSON.stringify(lay.blocks));
const pas=await b.ev('[...document.querySelectorAll("#plan-electrical .hot.passive")].map(e=>getComputedStyle(e).display)');
ok(pas.length===9&&pas.every(d=>d==='none'),'markers of the non-active layers: class passive, display none ('+pas.length+')');
await b.ev('T.layer("exterior")');await sleep(150);
ok(await b.ev('(()=>{const c=document.querySelector(".layer-chip.seen");return !!c&&[...document.querySelectorAll(".layer-chip.seen")].every(x=>{const a=getComputedStyle(x,"::after"),b2=getComputedStyle(x,"::before");return (a.content==="none"||a.display==="none"||a.content==="normal")&&(b2.content==="none"||b2.display==="none"||b2.content==="normal");})})()'),'seen class still set, its check mark not drawn');
// client who clicks layers himself
await b.ev('localStorage.clear();true');await b.reload();await sleep(1000);await b.ev(HELP);await b.ev('T.go("electrical")');await sleep(300);await b.ev(HELP);
await b.ev('window.scrollTo(0,0);true');await sleep(200);await b.ev('T.layer("interior")');await sleep(150);ok(['Next: Breaker box','Next: Exterior outlets'].includes(await b.ev(nextTxt)),'F opened interior himself: Next still walks the unseen layers -> '+await b.ev(nextTxt));
await b.ev('T.layer("exterior")');await sleep(150);await b.ev('T.layer("breaker")');await sleep(150);ok(await b.ev(nextTxt)==='Next','G all opened by chips: plain Next');
await b.ev('localStorage.clear();true');await b.reload();await sleep(1000);await b.ev(HELP);await b.ev('T.go("electrical")');await sleep(300);await b.ev(HELP);
await b.ev('document.getElementById("plan-electrical").scrollIntoView();true');await sleep(400);ok(await b.ev(nextTxt)==='Next: Exterior outlets','H scrolled to the plan himself: breaker counts as seen');
ok(b.exceptions().length===0,'no page errors '+JSON.stringify(b.exceptions()));b.close();console.log(bad?bad+' FAILED':'ALL PASS');process.exit(bad?1:0);})();
