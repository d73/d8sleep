'use strict';
const $ = id => document.getElementById(id);
let sides = [], selected = null, unit = 'F', busy = false, levelRunning = false, queuedLevel = null, dragging = false, deviceData = null;
document.querySelectorAll('#slider,#power').forEach(x=>x.disabled=true);
// Approximate community-derived mapping; levels are not thermometer readings.
const points = [[-100,55],[-90,61],[-58,68],[-17,77],[1,81],[17,86],[44,95],[72,104],[92,110],[100,111]];
function degrees(level) { if (typeof level !== 'number' || level < -100 || level > 100) return '—'; let f=points[0][1]; for(let i=1;i<points.length;i++){ const [x,y]=points[i], [px,py]=points[i-1]; if(level<=x){f=py+(y-py)*(level-px)/(x-px);break;} } return `${Math.round(unit==='F'?f:(f-32)*5/9)}°${unit}`; }
function say(text, online=false){ $('message').textContent=text; $('connection').textContent=online?'Connected':'Needs attention'; $('connection').classList.toggle('online',online); }
async function api(path, body){ let response; try {response=await fetch(path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});} catch {throw Error('Can’t reach d8sleep. Check your connection.');} const data=await response.json(); if(!response.ok) {const error=Error(data.error || 'Something went wrong.'); error.status=response.status;throw error;} return data; }
function colorSlider(n){ const t=(Math.max(-10,Math.min(10,n))+10)/20; const rgb=[Math.round(91+151*t),Math.round(159-57*t),Math.round(238-121*t)]; const color=`rgb(${rgb.join(' ')})`; $('slider').style.setProperty('--slider-color',color); $('target-circle').style.setProperty('--slider-color',color); }
function selectUnit(next){ unit=next; $('unit-f').setAttribute('aria-pressed',String(unit==='F')); $('unit-c').setAttribute('aria-pressed',String(unit==='C')); render(); }
function showCurrent(raw){const marker=$('current-marker');marker.hidden=!Number.isFinite(raw);if(!marker.hidden){const fraction=(Math.max(-100,Math.min(100,raw))+100)/200;marker.style.left=`calc(${fraction*100}% + ${16-32*fraction}px)`;}}
function displayLevel(raw){const n=raw/10;return (n>0?'+':'')+n.toFixed(1).replace(/\.0$/,'');}
function render(){ renderLive(); const item=sides.find(x=>x.side===selected); if(!item)return; $('sides').replaceChildren(); if(sides.length>1) for(const s of sides){const b=document.createElement('button');b.textContent=s.side[0].toUpperCase()+s.side.slice(1);b.className=s.side===selected?'active':'';b.disabled=busy;b.onclick=()=>{selected=s.side;render();};$('sides').append(b);} const level=Number.isInteger(item.target)?item.target:null; if(!dragging){$('value').textContent=level===null?'—':displayLevel(level); $('slider').value=level===null?0:Math.round(level/10);colorSlider(Number($('slider').value));} $('current').textContent=Number.isInteger(item.current)?displayLevel(item.current):'Unavailable'; showCurrent(item.power===false?null:item.current); $('current-detail').hidden=item.power===false; const estimated=degrees(dragging ? Number($('slider').value)*10 : level); $('estimate').textContent=estimated==='—'?'—':`~${estimated}`; $('power').textContent=item.power===null?'Power unavailable':item.power?'On':'Off'; $('power').setAttribute('aria-pressed',String(item.power===true)); $('power').disabled=busy || item.power===null; for(const x of document.querySelectorAll('#slider'))x.disabled=(busy && !levelRunning) || level===null; }
function renderLive(){
  const grid=$('live-status'), d=deviceData, side=sides.find(s=>s.side===selected);
  grid.replaceChildren();
  const row=(name,value)=>{const box=document.createElement('div'), label=document.createElement('span'), text=document.createElement('strong');label.textContent=name;text.textContent=value??'—';box.append(label,text);grid.append(box);};
  // Enumerated values: show every option, highlight the current one, dim the rest. An unlisted current value is appended so it is never hidden.
  const choice=(name,options,current)=>{
    const box=document.createElement('div'), label=document.createElement('span'), chips=document.createElement('div');
    label.textContent=name; chips.className='choices';
    const list=options.slice();
    if(current!==null&&current!==undefined&&!list.some(o=>o[0]===current))list.push([current,String(current)]);
    for(const [value,text] of list){const chip=document.createElement('em');chip.textContent=text;if(value===current){chip.className='on';chip.setAttribute('aria-current','true');}chips.append(chip);}
    box.append(label,chips);grid.append(box);
  };
  const bool=(name,current,yes='Yes',no='No')=>choice(name,[[true,yes],[false,no]],typeof current==='boolean'?current:null);
  const modes=[['off','Off'],['smart:bedtime','Bedtime'],['smart:initial','Early sleep'],['smart:final','Late sleep']];
  const when=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString();};
  const level=value=>Number.isInteger(value)?displayLevel(value):'—';
  if(d){
    bool('Connection',d.online,'Online','Offline');
    bool('Water',d.hasWater,'Present','Low / absent');
    bool('Priming',d.priming,'In progress','Not running');
    bool('Needs priming',d.needsPriming);
    bool('Temperature available',d.isTemperatureAvailable);
    row('Last heard',when(d.lastHeard));
    row('Last primed',when(d.lastPrime));
    row('Firmware',d.firmwareVersion||'—');
    bool('Firmware updating',d.firmwareUpdating);
  }
  if(side){
    choice('Selected side',[['left','Left'],['right','Right'],['solo','Solo']],side.side);
    bool('Side power',side.power,'On','Off');
    choice('Active mode',modes,side.mode||null);
    row('Mode started',when(side.mode_started));
    row('Target level',level(side.target));
    row('Current device level',side.power===false?'—':level(side.current));
    const running=side.side==='left'?d?.leftNowHeating:side.side==='right'?d?.rightNowHeating:null;
    bool('Temperature running',running);
    choice('Schedule type',[['smart','Smart'],['timeBased','Timed']],side.schedule_type||null);
    row('Bedtime level',level(side.smart?.bedTimeLevel));
    row('Early sleep level',level(side.smart?.initialSleepLevel));
    row('Late sleep level',level(side.smart?.finalSleepLevel));
    row('Timed level',level(side.timed?.level));
    row('Timed duration (configured)',Number.isFinite(side.timed?.durationSeconds)?`${side.timed.durationSeconds} seconds`:'—');
  }
}
let devicePolling=false;
async function pollDevice(){
  if(document.hidden||busy||dragging||devicePolling)return;
  devicePolling=true;
  try{const data=await api('/api/device');deviceData=data.device;$('live-updated').textContent=`Updated ${new Date().toLocaleTimeString()}`;$('live-error').textContent='';renderLive();}
  catch(e){$('live-error').textContent=`Device status: ${e.message}`;}
  finally{devicePolling=false;}
}
setInterval(pollDevice,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pollDevice();});
void pollDevice();
function update(data){if(data.pod_name)$('pod-name').textContent=data.pod_name;sides=data.sides;if(!sides.some(s=>s.side===selected))selected=sides[0]?.side;render();say('',true);}
async function refresh(){try{update(await api('/api/status'));}catch(e){say(e.message);}}
let polling=false, revision=0;
async function pollStatus(){if(document.hidden||busy||dragging||polling)return;polling=true;const atStart=revision;try{const data=await api('/api/status');if(!busy&&!dragging&&revision===atStart)update(data);}catch(e){if(!busy&&!dragging)say(e.message);}finally{polling=false;}}
setInterval(pollStatus,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pollStatus();});
async function change(path, data){if(busy)return;revision++;busy=true;render();say('Updating…',true);try{update(await api(path,data));}catch(e){say(e.message);await refreshAfterError();}finally{busy=false;render();}}
async function refreshAfterError(){try{const data=await api('/api/status');sides=data.sides;}catch{}}
function level(n){
  if(busy && !levelRunning)return;
  const raw=Math.max(-10,Math.min(10,n))*10, item=sides.find(s=>s.side===selected);
  if(!item)return;
  revision++; item.target=raw;
  queuedLevel={side:selected,level:raw};
  busy=true; levelRunning=true; render(); say('Updating…',true);
  if(!levelSending) void sendLevels();
}
let levelSending=false;
async function sendLevels(){
  levelSending=true;
  try{
    while(queuedLevel){
      const request=queuedLevel; queuedLevel=null;
      const data=await api('/api/level',request);
      sides=data.sides;
      if(queuedLevel){
        const pending=sides.find(s=>s.side===queuedLevel.side);
        if(pending)pending.target=queuedLevel.level;
      }
      render();
    }
    say('',true);
  }catch(e){
    queuedLevel=null; levelRunning=false; render();
    await refreshAfterError();
    say(e.message);
  }finally{
    levelSending=false; levelRunning=false; busy=false; render();
  }
}
$('slider').oninput=()=>{dragging=true;colorSlider(Number($('slider').value));$('value').textContent=displayLevel(Number($('slider').value)*10);$('estimate').textContent=`~${degrees(Number($('slider').value)*10)}`;};$('slider').onchange=()=>{dragging=false;level(Number($('slider').value));};
for(const event of ['pointerup','pointercancel','touchend','touchcancel','keyup'])$('slider').addEventListener(event,()=>setTimeout(()=>{if(dragging){dragging=false;render();}},0));$('power').onclick=()=>change('/api/power',{side:selected,on:!sides.find(s=>s.side===selected).power});$('unit-f').onclick=()=>selectUnit('F');$('unit-c').onclick=()=>selectUnit('C');refresh();
// Drawers: Pod status slides out left of the control, session biometrics right. Escape, backdrop or × closes.
function setDrawer(id,open){const d=$(id);d.classList.toggle('open',open);d.setAttribute('aria-hidden',String(!open));const tab=id==='drawer-status'?$('tab-status'):$('tab-session');tab.setAttribute('aria-expanded',String(open));tab.classList.toggle('active',open);const any=document.querySelector('.drawer.open');$('drawer-backdrop').hidden=!any;if(open&&id==='drawer-status')void pollDevice();}
function toggleDrawer(id){const d=$(id);for(const other of document.querySelectorAll('.drawer'))if(other!==d&&other.classList.contains('open')&&window.matchMedia('(max-width:1199px)').matches)setDrawer(other.id,false);setDrawer(id,!d.classList.contains('open'));}
$('tab-status').onclick=()=>toggleDrawer('drawer-status');$('tab-session').onclick=()=>toggleDrawer('drawer-session');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>setDrawer(b.dataset.close,false);
$('drawer-backdrop').onclick=()=>{for(const d of document.querySelectorAll('.drawer.open'))setDrawer(d.id,false);};
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const d of document.querySelectorAll('.drawer.open'))setDrawer(d.id,false);});
for(const d of document.querySelectorAll('.drawer'))d.setAttribute('aria-hidden','true');
