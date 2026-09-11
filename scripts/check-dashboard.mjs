import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Execute the real scripts with a minimal element interface to catch startup
// errors and verify empty/stale states without launching a browser process.
const html = fs.readFileSync('index.html', 'utf8');
const extra = fs.readFileSync('dashboard-extra.js', 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
// Layout-dependent members report zero size: the carousel then takes its
// "everything fits, stay still" path, which is what a headless check can
// meaningfully assert.
const stub = id => ({
  hidden: /^(nba|afl|f1)-card$/.test(id), innerHTML:'',textContent:'',style:{},dataset:{},
  children:[], clientHeight:0, scrollHeight:0, offsetTop:0,
  classList:{toggle(){},add(){},remove(){},contains(){return false;}},
  setAttribute(){},removeAttribute(){},addEventListener(){},appendChild(){},
  querySelectorAll(){return [];},closest(){return null;},
  cloneNode(){return stub('clone');},animate(){return {cancel(){}};},
  getBoundingClientRect(){return {height:0,width:0,top:0,left:0};},
});
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],stub(m[1])]));
const storage = new Map();
const requests = [];
const pending = new Set();
const live = process.argv.includes('--live');
const context = vm.createContext({
  console, URL, Date, Intl, AbortController, setTimeout, clearTimeout,
  setInterval(){}, navigator:{onLine:live},
  getComputedStyle(){return {rowGap:'18px'};},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{addEventListener(){}},
  document:{
    getElementById(id){assert.ok(elements.has(id),'Missing HTML element: '+id);return elements.get(id);},
    querySelectorAll(){return [];},
    addEventListener(){},documentElement:{},
  },
  fetch:async(url,options)=>{
    let request;
    if(url.startsWith('data/') || url.includes('/data/fuel.json')){
      request=Promise.resolve(new Response(fs.readFileSync('data/fuel.json','utf8'),{headers:{'content-type':'application/json'}}));
    }else{
      request=fetch(url,options);
    }
    pending.add(request);
    try{const result=await request;requests.push({host:new URL(url,'http://localhost').hostname,status:result.status});return result;}
    finally{pending.delete(request);}
  },
});
new vm.Script(extra).runInContext(context);
new vm.Script(inline).runInContext(context);
const run=code=>vm.runInContext(code,context);

assert.equal(elements.get('nba-card').hidden,true,'Empty NBA must be hidden');
run("renderLeagueCard(document.getElementById('nba-card'), {label:'NBA',games:[]}, 'NBA')");
assert.equal(elements.get('nba-card').hidden,true);
run("renderLeagueCard(document.getElementById('nba-card'), {label:'NBA',games:[{date:'2000-01-01'}]}, 'NBA')");
assert.equal(elements.get('nba-card').hidden,true,'Old cached games must be hidden');
run("drawF1Card({empty:true})");
assert.equal(elements.get('f1-card').hidden,true,'Off-season F1 must be hidden');
run("fuelSnapshot={product:2,updatedAt:'2000-01-01',days:{'2000-01-01':[{price:99}]}};renderFuel()");
assert.ok(!elements.get('fuel-content').innerHTML.includes('99'),'Expired fuel prices must not be shown as current');
assert.equal(run('escapeHtml(\'<img title="x">\')'),'&lt;img title=&quot;x&quot;&gt;');
assert.equal(run("safeImageUrl('javascript:alert(1)')"),'');
console.log('PASS: startup, missing elements, empty sports, expired sports/fuel, safe HTML and image URLs');

if(live){
  // Wait only on real network operations; do not launch a background process.
  while(pending.size) await Promise.allSettled([...pending]);
  await new Promise(resolve=>setTimeout(resolve,50));
  run("fuelSnapshot = null");
  await run('refreshFuel()');
  assert.ok(elements.get('fuel-content').innerHTML.includes('cents / litre'),'Live fuel did not render');
  assert.ok(elements.get('events-list').innerHTML.includes('event-item'),'Calendars did not render');
  const f1=await run('loadF1Data()');
  assert.ok(f1?.raceName,'F1 race unavailable');
  context.checkedF1=f1;
  run('drawF1Card(checkedF1)');
  assert.ok(elements.get('f1-card').innerHTML.includes('driver-portrait'),'Driver image absent');
  assert.ok(elements.get('f1-card').innerHTML.includes('f1-track'),'Circuit image absent');
  for(const [name,url] of [['circuit',f1.circuitImage],['driver',f1.leader.image||f1.leader.fallbackImage]]){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    assert.ok(response.ok && response.headers.get('content-type')?.startsWith('image/'),name+' did not load');
  }
  console.log('PASS: live calendar rendering, current fuel ranking, F1 identity and both image responses');
  console.log('Public API requests:',JSON.stringify(requests));
}
