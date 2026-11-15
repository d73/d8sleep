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
  const yesNo=(value,yes='Yes',no='No')=>typeof value==='boolean'?(value?yes:no):'—';
  const when=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString();};
  const level=value=>Number.isInteger(value)?displayLevel(value):'—';
  if(d){
    row('Connection',yesNo(d.online,'Online','Offline'));
    row('Water',yesNo(d.hasWater,'Present','Low / absent'));
    row('Priming',yesNo(d.priming,'In progress','Not running'));
    row('Needs priming',yesNo(d.needsPriming));
    row('Temperature available',yesNo(d.isTemperatureAvailable));
    row('Last heard',when(d.lastHeard));
    row('Last primed',when(d.lastPrime));
    row('Firmware',d.firmwareVersion||'—');
    row('Firmware updating',yesNo(d.firmwareUpdating));
  }
  if(side){
    row('Selected side',side.side.charAt(0).toUpperCase()+side.side.slice(1));
    row('Side power',yesNo(side.power,'On','Off'));
    row('Active mode',side.mode||'—');
    row('Mode started',when(side.mode_started));
    row('Target level',level(side.target));
    row('Current device level',side.power===false?'—':level(side.current));
    const running=side.side==='left'?d?.leftNowHeating:side.side==='right'?d?.rightNowHeating:null;
    row('Temperature running',yesNo(running));
    row('Schedule type',side.schedule_type||'—');
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
