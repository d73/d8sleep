'use strict';
const $ = id => document.getElementById(id);
let sides = [], selected = null, unit = 'F', busy = false, levelRunning = false, queuedLevel = null, dragging = false, deviceData = null, sessionData = null, sessionSide = null;
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
function render(){ renderLive(); renderSession(); const item=sides.find(x=>x.side===selected); if(!item)return; $('sides').replaceChildren(); if(sides.length>1) for(const s of sides){const b=document.createElement('button');b.textContent=s.side[0].toUpperCase()+s.side.slice(1);b.className=s.side===selected?'active':'';b.disabled=busy;b.onclick=()=>{selected=s.side;sessionRequest++;sessionInFlight=null;sessionData=null;sessionSide=null;render();void pollSession();};$('sides').append(b);} const level=Number.isInteger(item.target)?item.target:null; if(!dragging){$('value').textContent=level===null?'—':displayLevel(level); $('slider').value=level===null?0:Math.round(level/10);colorSlider(Number($('slider').value));} $('current').textContent=Number.isInteger(item.current)?displayLevel(item.current):'Unavailable'; showCurrent(item.power===false?null:item.current); $('current-detail').hidden=item.power===false; const estimated=degrees(dragging ? Number($('slider').value)*10 : level); $('estimate').textContent=estimated==='—'?'—':`~${estimated}`; $('power').textContent=item.power===null?'Power unavailable':item.power?'On':'Off'; $('power').setAttribute('aria-pressed',String(item.power===true)); $('power').disabled=busy || item.power===null; for(const x of document.querySelectorAll('#slider'))x.disabled=(busy && !levelRunning) || level===null; }
const HELP={
  'Connection':"Whether the Pod is online and talking to Eight Sleep's servers.",
  'Water':"Whether the Pod's reservoir has water. Low or absent water stops heating and cooling.",
  'Priming':"The Pod is filling its water lines right now and can't heat or cool until it finishes.",
  'Needs priming':"The Pod reports it should be primed, for example after water was added or the lines emptied.",
  'Temperature available':"Whether the Pod says temperature control is available right now.",
  'Last heard':"When the Pod last checked in with Eight Sleep.",
  'Last primed':"When the Pod last finished priming.",
  'Firmware':"The Pod's installed firmware version.",
  'Firmware updating':"The Pod is installing a firmware update and may be unresponsive.",
  'Selected side':"The bed side shown in the control and in this panel.",
  'Side power':"Whether temperature control is on for this side.",
  'Active mode':"What this side is doing now. Bedtime, early sleep and late sleep are stages of the smart schedule. The full list of modes isn't documented, so unknown values are added as they appear.",
  'Mode started':"When the current mode began.",
  'Target level':"The level you or the schedule asked for, on the app's -10 to +10 scale.",
  'Target / Now':"The requested level and reported device level; the latter is not a measured temperature.",
  'Current device level':"The level the Pod is running at right now. It can lag the target while ramping. It is not a measured temperature.",
  'Temperature running':"Whether this side's heating or cooling is actively running.",
  'Schedule type':"How this side's temperature is scheduled: a smart schedule of levels through the night, or a timed setting.",
  'Bedtime level':"Smart schedule: the level used when you get into bed.",
  'Early sleep level':"Smart schedule: the level for the first part of the night.",
  'Late sleep level':"Smart schedule: the level for the later part of the night.",
  'Timed level':"The level used by a timed temperature setting.",
  'Timed duration (configured)':"How long a timed setting is configured to run, in seconds. It is not a countdown.",
  'Session start':"When Eight Sleep says you got into bed for the latest session.",
  'Presence end':"When Eight Sleep reports the end of presence. Incomplete sessions may change.",
  'Session state':"Incomplete means the session isn't finished or fully processed, so numbers may still change.",
  'Heart rate':"Latest heart rate sample from the session. It may be delayed.",
  'HRV':"Heart rate variability from the latest session sample. Early readings can be noisy.",
  'Respiratory rate':"Breaths per minute from the latest session sample.",
  'Bed temperature':"Temperature at the bed surface from the latest session sample (delayed).",
  'Room temperature':"Room temperature near the Pod from the latest session sample (delayed)."
};
const openHelp=new Set();
function helpFor(box,name){
  const text=HELP[name];if(!text)return;
  box.title=text;box.classList.add('has-help');
  const button=document.createElement('button'),tip=document.createElement('span');
  button.type='button';button.className='help-button';button.textContent='?';button.setAttribute('aria-label',`About ${name}`);
  tip.className='help-text';tip.textContent=text;tip.hidden=!openHelp.has(name);
  button.setAttribute('aria-expanded',String(!tip.hidden));
  button.onclick=()=>{tip.hidden=!tip.hidden;button.setAttribute('aria-expanded',String(!tip.hidden));if(tip.hidden)openHelp.delete(name);else openHelp.add(name);};
  box.append(button,tip);
}
function tile(name,value,stamp,withDot=false){
  const box=document.createElement('div'),label=document.createElement('span'),text=document.createElement('strong');
  box.className='metric-tile';label.className='metric-label';label.textContent=name;text.textContent=value??'—';box.append(label,text);
  if(withDot){const dot=document.createElement('span');dot.className='status-dot';dot.setAttribute('aria-hidden','true');box.append(dot);}
  if(stamp){const time=document.createElement('small');const date=new Date(stamp);time.textContent=Number.isNaN(date.getTime())?'Sample time unavailable':`Sample: ${date.toLocaleString()}`;box.append(time);}
  helpFor(box,name);return box;
}
function choiceTile(name,options,current){
  const box=document.createElement('div'),label=document.createElement('span'),chips=document.createElement('div');if(name==='Session state')box.classList.add('session-state');label.textContent=name;chips.className='choices';
  const list=options.slice();if(current!==null&&current!==undefined&&!list.some(o=>o[0]===current))list.push([current,String(current)]);
  for(const [value,text] of list){const chip=document.createElement('em');chip.textContent=text;if(value===current){chip.className='on';chip.setAttribute('aria-current','true');}chips.append(chip);}
  box.append(label,chips);helpFor(box,name);return box;
}
function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString();}
function renderLive(){
  const hero=$('live-status'),segments=$('live-segments'),details=$('live-details'),d=deviceData,side=sides.find(s=>s.side===selected);
  hero.replaceChildren();segments.replaceChildren();details.replaceChildren();
  const level=value=>Number.isInteger(value)?displayLevel(value):'—';
  const yesNo=(value,yes='Yes',no='No')=>typeof value==='boolean'?(value?yes:no):'—';
  const bool=(name,value,yes='Yes',no='No')=>choiceTile(name,[[true,yes],[false,no]],typeof value==='boolean'?value:null);
  hero.append(tile('Side power',yesNo(side?.power,'On','Off'),null,side?.power===true));
  const modeLabels={'off':'Off','smart:bedtime':'Bedtime','smart:initial':'Early sleep','smart:final':'Late sleep'};
  hero.append(tile('Active mode',modeLabels[side?.mode]||side?.mode||'—'));
  hero.append(tile('Water',yesNo(d?.hasWater,'Present','Low / absent')));
  hero.append(tile('Target / Now',`${level(side?.target)} / ${side?.power===false?'—':level(side?.current)}`));
  segments.append(bool('Connection',d?.online,'Online','Offline'));
  segments.append(choiceTile('Schedule type',[['smart','Smart'],['timeBased','Timed']],side?.schedule_type||null));
  segments.append(choiceTile('Selected side',[['left','Left'],['right','Right'],['solo','Solo']],side?.side||null));
  if(d){
    details.append(bool('Priming',d.priming,'In progress','Not running'),bool('Needs priming',d.needsPriming),bool('Temperature available',d.isTemperatureAvailable));
    details.append(tile('Last heard',when(d.lastHeard)),tile('Last primed',when(d.lastPrime)),tile('Firmware',d.firmwareVersion||'—'),bool('Firmware updating',d.firmwareUpdating));
  }
  if(side){
    const running=side.side==='left'?d?.leftNowHeating:side.side==='right'?d?.rightNowHeating:null;
    details.append(bool('Side power',side.power,'On','Off'),choiceTile('Active mode',[['off','Off'],['smart:bedtime','Bedtime'],['smart:initial','Early sleep'],['smart:final','Late sleep']],side.mode||null));
    details.append(tile('Mode started',when(side.mode_started)),tile('Target level',level(side.target)),tile('Current device level',side.power===false?'—':level(side.current)),bool('Temperature running',running));
    details.append(tile('Bedtime level',level(side.smart?.bedTimeLevel)),tile('Early sleep level',level(side.smart?.initialSleepLevel)),tile('Late sleep level',level(side.smart?.finalSleepLevel)),tile('Timed level',level(side.timed?.level)),tile('Timed duration (configured)',Number.isFinite(side.timed?.durationSeconds)?`${side.timed.durationSeconds} seconds`:'—'));
  }
}
let sessionRequest=0, sessionInFlight=null;
function renderSession(){
  const grid=$('session-status'),meta=$('session-meta'),resp=$('session-respiratory');grid.replaceChildren();meta.replaceChildren();resp.replaceChildren();
  if(!sessionData||sessionSide!==selected){const msg=document.createElement('p');msg.textContent='No session data available yet.';grid.append(msg);return;}
  meta.append(tile('Session start',when(sessionData.start)));
  meta.append(choiceTile('Session state',[[false,'Complete'],[true,'Incomplete'],[null,'Not reported']],sessionData.incomplete));
  if(sessionData.presence_end)meta.append(tile('Presence end',when(sessionData.presence_end)));
  const specs=[['heartRate','Heart rate',' bpm'],['hrv','HRV',' ms'],['tempBedC','Bed temperature',''],['tempRoomC','Room temperature',''],['respiratoryRate','Respiratory rate',' breaths/min']];
  for(const [key,label,suffix] of specs){
    const sample=sessionData.metrics?.[key];let value='Not available';
    if(sample&&Number.isFinite(sample.value)){if(key==='tempBedC'||key==='tempRoomC'){const n=unit==='F'?sample.value*9/5+32:sample.value;value=`${n.toFixed(1)}°${unit}`;}else value=`${sample.value}${suffix}`;}
    const card=tile(label,value,sample?.timestamp);(key==='respiratoryRate'?resp:grid).append(card);
  }
}
async function pollSession(){
  if(document.hidden||!selected||busy||dragging||sessionInFlight===selected)return;
  const side=selected, request=++sessionRequest;sessionInFlight=side;
  try{const data=await api(`/api/session?side=${encodeURIComponent(side)}`);if(selected!==side||request!==sessionRequest)return;sessionData=data.session;sessionSide=side;$('session-error').textContent='';renderSession();}
  catch(e){if(selected===side&&request===sessionRequest){$('session-error').textContent=`Session data: ${e.message}`;}}
  finally{if(request===sessionRequest)sessionInFlight=null;}
}
setInterval(pollSession,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pollSession();});
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
function update(data){if(data.pod_name)$('pod-name').textContent=data.pod_name;const previous=selected;sides=data.sides;if(!sides.some(s=>s.side===selected))selected=sides[0]?.side;if(selected!==previous){sessionRequest++;sessionInFlight=null;sessionData=null;sessionSide=null;void pollSession();}render();say('',true);}
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
