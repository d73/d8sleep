'use strict';
const $ = id => document.getElementById(id);
const THEME_KEY = 'd8sleep.theme';
function applyTheme(theme, persist = false) {
  const day = theme === 'day';
  document.documentElement.dataset.theme = day ? 'day' : 'night';
  $('theme-day').setAttribute('aria-pressed', String(day));
  $('theme-night').setAttribute('aria-pressed', String(!day));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', day ? '#f0f3f9' : '#10141c');
  if (persist) try { localStorage.setItem(THEME_KEY, day ? 'day' : 'night'); } catch {}
}
let savedTheme = 'night';
try { savedTheme = localStorage.getItem(THEME_KEY) || 'night'; } catch {}
applyTheme(savedTheme);
$('theme-day').addEventListener('click', () => applyTheme('day', true));
$('theme-night').addEventListener('click', () => applyTheme('night', true));
let sides = [], selected = null, unit = 'F', busy = false, levelRunning = false, queuedLevel = null, dragging = false, deviceData = null, sessionData = null, sessionSide = null;
const ACCENT_KEY = 'd8sleep.accent', TEMPERATURE_KEY = 'd8sleep.temperature';
function applyAccent(accent, persist = false){
  if(!['blue','teal','amber','rose','plum'].includes(accent))accent='blue';
  document.documentElement.dataset.accent=accent;
  for(const button of document.querySelectorAll('button[data-accent]'))button.setAttribute('aria-pressed',String(button.dataset.accent===accent));
  if(persist)try{localStorage.setItem(ACCENT_KEY,accent);}catch{}
}
function applyTemperature(choice, persist = false){
  if(!['off','C','F'].includes(choice))choice='off';
  if(choice!=='off')unit=choice;
  $('estimate').hidden=choice==='off';
  $('unit-off').setAttribute('aria-pressed',String(choice==='off'));
  $('unit-c').setAttribute('aria-pressed',String(choice==='C'));
  $('unit-f').setAttribute('aria-pressed',String(choice==='F'));
  if(persist){try{localStorage.setItem(TEMPERATURE_KEY,choice);}catch{}render();}
}
let savedAccent='blue', savedTemperature='off';
try{savedAccent=localStorage.getItem(ACCENT_KEY)||'blue';savedTemperature=localStorage.getItem(TEMPERATURE_KEY)||'off';}catch{}
applyAccent(savedAccent);applyTemperature(savedTemperature);
for(const button of document.querySelectorAll('button[data-accent]'))button.addEventListener('click',()=>applyAccent(button.dataset.accent,true));
let statusAvailable = false;
// Only side labels are cached; controls remain disabled until fresh status arrives.
const SIDE_CACHE = 'd8sleep.side-labels';
function restoreSidePlaceholders() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SIDE_CACHE));
    if (!Array.isArray(saved) || saved.length !== 2 || new Set(saved).size !== 2 || !saved.every(s => s === 'left' || s === 'right')) return;
    for (const side of saved) {
      const button = document.createElement('button');
      button.textContent = side[0].toUpperCase() + side.slice(1);
      button.disabled = true;
      $('sides').append(button);
    }
  } catch { /* An empty, reserved row still prevents a layout jump. */ }
}
function rememberSideLabels() {
  try {
    const labels = sides.map(s => s.side);
    if (labels.length === 2 && new Set(labels).size === 2 && labels.every(s => s === 'left' || s === 'right')) sessionStorage.setItem(SIDE_CACHE, JSON.stringify(labels));
    else sessionStorage.removeItem(SIDE_CACHE);
  } catch { /* Storage is optional. */ }
}
restoreSidePlaceholders();
// Restore wording only; startup keeps the power control disabled until status arrives.
const POWER_LABEL_CACHE = 'd8sleep.power-label';
function restorePowerLabel(){
  try{const label=sessionStorage.getItem(POWER_LABEL_CACHE);if(label==='On'||label==='Off')$('power').textContent=label;}catch{}
}
function rememberPowerLabel(power){
  try{if(power===true||power===false)sessionStorage.setItem(POWER_LABEL_CACHE,power?'On':'Off');else sessionStorage.removeItem(POWER_LABEL_CACHE);}catch{}
}
restorePowerLabel();
document.querySelectorAll('#slider,#power').forEach(x=>x.disabled=true);
// Approximate community-derived mapping; levels are not thermometer readings.
const points = [[-100,55],[-90,61],[-58,68],[-17,77],[1,81],[17,86],[44,95],[72,104],[92,110],[100,111]];
function degrees(level) { if (typeof level !== 'number' || level < -100 || level > 100) return '—'; let f=points[0][1]; for(let i=1;i<points.length;i++){ const [x,y]=points[i], [px,py]=points[i-1]; if(level<=x){f=py+(y-py)*(level-px)/(x-px);break;} } return `${Math.round(unit==='F'?f:(f-32)*5/9)}°${unit}`; }
function say(text, online=false){ $('message').textContent=text; $('connection').textContent=online?'Connected':'Needs attention'; $('connection').classList.toggle('online',online); }
async function api(path, body){ let response; try {response=await fetch(path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});} catch {throw Error('Can’t reach d8sleep. Check your connection.');} const data=await response.json(); if(!response.ok) {const error=Error(data.error || 'Something went wrong.'); error.status=response.status;throw error;} return data; }
function colorSlider(n){ const t=(Math.max(-10,Math.min(10,n))+10)/20; const rgb=[Math.round(91+151*t),Math.round(159-57*t),Math.round(238-121*t)]; const color=`rgb(${rgb.join(' ')})`; $('slider').style.setProperty('--slider-color',color); $('target-circle').style.setProperty('--slider-color',color); }

function showCurrent(raw){const marker=$('current-marker');marker.hidden=!Number.isFinite(raw);if(!marker.hidden){const fraction=(Math.max(-100,Math.min(100,raw))+100)/200;marker.style.left=`calc(${fraction*100}% + ${16-32*fraction}px)`;}}
function displayLevel(raw){const n=raw/10;return (n>0?'+':'')+n.toFixed(1).replace(/\.0$/,'');}
let readOnly = false;
function syncSliderAvailability(item, level){
  const slider=$('slider'), off=item.power===false;
  slider.disabled=readOnly || off || (busy && !levelRunning) || level===null;
  slider.dataset.off=String(off);
  slider.setAttribute('aria-describedby',off?'current-level-help slider-off-help':'current-level-help');
  slider.title=readOnly?'Read-only on this device':off?'Turn on to adjust the heating level':'';
}
function render(){ renderLive(); renderSession(); const item=sides.find(x=>x.side===selected); if(!item)return; rememberSideLabels(); $('sides').hidden=sides.length<2; $('sides').replaceChildren(); if(sides.length>1) for(const s of sides){const b=document.createElement('button');b.textContent=s.side[0].toUpperCase()+s.side.slice(1);b.className=s.side===selected?'active':'';b.disabled=busy;b.onclick=()=>{selected=s.side;sessionRequest++;sessionInFlight=null;sessionData=null;sessionSide=null;render();void pollSession();};$('sides').append(b);} const level=Number.isInteger(item.target)?item.target:null; if(!dragging){$('value').textContent=level===null?'—':displayLevel(level); $('slider').value=level===null?0:Math.round(level/10);colorSlider(Number($('slider').value));} $('current').textContent=Number.isInteger(item.current)?displayLevel(item.current):''; showCurrent(item.power===false?null:item.current); syncCurrentDetail(); const estimated=degrees(dragging ? Number($('slider').value)*10 : level); $('estimate').textContent=estimated==='—'?'—':`~${estimated}`; $('power').textContent=item.power===null?'Power unavailable':item.power?'On':'Off'; rememberPowerLabel(item.power); $('power').setAttribute('aria-pressed',String(item.power===true)); $('power').disabled=readOnly || busy || item.power===null; $('power').title=readOnly?'Read-only on this device':''; syncSliderAvailability(item,level); }
function choiceList(options,current){
  const chips=document.createElement('div');chips.className='choices';
  const list=options.slice();if(current!==null&&current!==undefined&&!list.some(o=>o[0]===current))list.push([current,String(current)]);
  for(const [value,text] of list){const chip=document.createElement('em');chip.textContent=text;if(value===current){chip.className='on';chip.setAttribute('aria-current','true');}chips.append(chip);}
  return chips;
}
function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString();}
function renderLive(){
  const strip=$('status-strip'), hero=$('live-status'), details=$('live-details'), d=deviceData, side=sides.find(s=>s.side===selected);
  strip.replaceChildren();hero.replaceChildren();details.replaceChildren();
  const level=value=>Number.isInteger(value)?displayLevel(value):'—';
  const yesNo=(value,yes='Yes',no='No')=>typeof value==='boolean'?(value?yes:no):'—';
  const tag=(text,state)=>{const item=document.createElement('span'),dot=document.createElement('i'),label=document.createElement('span');item.className='status-tag';dot.className=state===true?'status-tag-dot good':state===false?'status-tag-dot bad':'status-tag-dot';dot.setAttribute('aria-hidden','true');label.textContent=text;item.append(dot,label);strip.append(item);};
  tag(yesNo(d?.online,'Online','Offline')==='—'?'Connection unknown':yesNo(d?.online,'Online','Offline'),d?.online);
  tag(yesNo(d?.hasWater,'Water','Water low / absent')==='—'?'Water unknown':yesNo(d?.hasWater,'Water','Water low / absent'),d?.hasWater);
  const fw=document.createElement('span');fw.className='status-firmware';fw.textContent=`FW ${d?.firmwareVersion||'—'}`;strip.append(fw);
  const card=(title)=>{const box=document.createElement('div'),label=document.createElement('span');box.className='bento-card';label.className='bento-label';label.textContent=title;box.append(label);return box;};
  const line=(box,value,cls)=>{const text=document.createElement('span');text.className=cls;text.textContent=value;box.append(text);};
  const modes=[['off','Off'],['smart:bedtime','Bedtime'],['smart:initial','Early sleep'],['smart:final','Late sleep']];
  const modeLabels={'off':'Off','smart:bedtime':'Bedtime','smart:initial':'Early sleep','smart:final':'Late sleep'};
  const mode=modeLabels[side?.mode]||side?.mode||'—';
  const active=card('Active state');
  line(active,side?.power===false?'Off':side?.power===true?`On · ${mode}`:'Power unknown',side?.power===true?'bento-value active':'bento-value');
  const powerChoices=choiceList([[true,'On'],[false,'Off']],typeof side?.power==='boolean'?side.power:null);powerChoices.setAttribute('role','group');powerChoices.setAttribute('aria-label','Power states');active.append(powerChoices);
  const modeChoices=choiceList(modes,side?.mode||null);modeChoices.setAttribute('role','group');modeChoices.setAttribute('aria-label','Known modes');active.append(modeChoices);
  line(active,`Started ${when(side?.mode_started)} · Side: ${side?.side?side.side.charAt(0).toUpperCase()+side.side.slice(1):'—'}`,'bento-subtext');hero.append(active);
  const thermal=card('Thermal');line(thermal,level(side?.target),'bento-value');
  line(thermal,`Currently ${side?.power===false?'—':level(side?.current)}`,'bento-subtext');
  const schedule=choiceList([['smart','Smart'],['timeBased','Timed']],side?.schedule_type||null);schedule.setAttribute('role','group');schedule.setAttribute('aria-label','Schedule types');thermal.append(schedule);hero.append(thermal);
  const stat=(name,value)=>{const item=document.createElement('div'),label=document.createElement('span'),text=document.createElement('strong');label.textContent=name;text.textContent=value;item.append(label,text);details.append(item);};
  stat('Bedtime level',level(side?.smart?.bedTimeLevel));stat('Early sleep level',level(side?.smart?.initialSleepLevel));stat('Late sleep level',level(side?.smart?.finalSleepLevel));
  stat('Timed level',level(side?.timed?.level));stat('Timed duration (configured)',Number.isFinite(side?.timed?.durationSeconds)?`${side.timed.durationSeconds} seconds`:'—');
  stat('Priming',yesNo(d?.priming,'In progress','Not running'));stat('Needs priming',yesNo(d?.needsPriming));stat('Firmware updating',yesNo(d?.firmwareUpdating));
  stat('Last heard',when(d?.lastHeard));stat('Last primed',when(d?.lastPrime));
  const running=side?.side==='left'?d?.leftNowHeating:side?.side==='right'?d?.rightNowHeating:null;stat('Temperature running',yesNo(running));
}
let sessionRequest=0, sessionInFlight=null, sessionCheckedAt=null;
function renderSession(){
  const grid=$('session-status'),meta=$('session-meta'),details=$('session-respiratory');grid.replaceChildren();meta.replaceChildren();details.replaceChildren();
  const session=sessionSide===selected?sessionData:null;
  $('session-updated').textContent=sessionSide===selected && sessionCheckedAt ? `Checked ${when(sessionCheckedAt)}` : '';
  const state=session?.incomplete===true?'Incomplete':session?.incomplete===false?'Complete':'Not reported';
  const status=document.createElement('span'),dot=document.createElement('i'),statusText=document.createElement('span');
  status.className='status-tag';dot.className=session?.incomplete===false?'status-tag-dot good':session?.incomplete===true?'status-tag-dot pending':'status-tag-dot';dot.setAttribute('aria-hidden','true');statusText.textContent=state;status.append(dot,statusText);meta.append(status);
  const side=document.createElement('span');side.className='status-firmware';side.textContent=`Side: ${selected?selected.charAt(0).toUpperCase()+selected.slice(1):'—'}`;meta.append(side);
  const specs=[['heartRate','Heart rate',' bpm'],['hrv','HRV',' ms'],['tempBedC','Bed temp',''],['tempRoomC','Room temp','']];
  const sampleText=(sample,key,suffix)=>{if(!sample||!Number.isFinite(sample.value))return 'Not available';if(key==='tempBedC'||key==='tempRoomC'){const n=unit==='F'?sample.value*9/5+32:sample.value;return `${Math.round(n)}°${unit}`;}return `${Math.round(sample.value)}${suffix}`;};
  for(const [key,label,suffix] of specs){const sample=session?.metrics?.[key],box=document.createElement('div'),heading=document.createElement('span'),value=document.createElement('strong'),time=document.createElement('small');box.className='bento-card';heading.className='bento-label';heading.textContent=label;value.className='bento-value';value.textContent=sampleText(sample,key,suffix);time.className='bento-subtext';time.textContent=sample?.timestamp?`Sample: ${when(sample.timestamp)}`:'Sample time unavailable';box.append(heading,value,time);grid.append(box);}
  const stat=(name,value,stamp)=>{const item=document.createElement('div'),label=document.createElement('span'),text=document.createElement('strong');label.textContent=name;text.textContent=value;item.append(label,text);if(stamp){const time=document.createElement('small');time.textContent=`Sample: ${when(stamp)}`;item.append(time);}details.append(item);};
  const respiratory=session?.metrics?.respiratoryRate;stat('Resp rate',sampleText(respiratory,'respiratoryRate',' breaths/min'),respiratory?.timestamp);
  stat('Session start',when(session?.start));stat('Presence end',when(session?.presence_end));
  const stateBox=document.createElement('div'),stateLabel=document.createElement('span');stateBox.className='session-state-line';stateLabel.textContent='Session state';const stateChoices=choiceList([[false,'Complete'],[true,'Incomplete'],[null,'Not reported']],session?.incomplete??null);stateChoices.setAttribute('role','group');stateChoices.setAttribute('aria-label','Session states');stateBox.append(stateLabel,stateChoices);details.append(stateBox);
  renderHeartChart(session?.heart_rate_series);
}
function renderHeartChart(samples){
  const container=$('heart-chart-content');container.replaceChildren();
  const points=(Array.isArray(samples)?samples:[]).filter(p=>p&&typeof p.value==='number'&&Number.isFinite(p.value)&&typeof p.timestamp==='string'&&Number.isFinite(Date.parse(p.timestamp))).map(p=>({time:Date.parse(p.timestamp),value:p.value})).sort((a,b)=>a.time-b.time);
  if(!points.length){const empty=document.createElement('p');empty.className='heart-chart-empty';empty.textContent='No heart-rate samples available for this session.';container.append(empty);return;}
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
  const node=(name,attrs)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
  let min=Infinity,max=-Infinity;for(const p of points){min=Math.min(min,p.value);max=Math.max(max,p.value);}
  const low=Math.floor((min-5)/10)*10, high=Math.ceil((max+5)/10)*10;
  const first=points[0].time,last=points[points.length-1].time, x=time=>first===last?173:36+(time-first)/(last-first)*274, y=value=>140-(value-low)/(high-low)*128;
  svg.setAttribute('viewBox','0 0 320 160');svg.setAttribute('role','img');svg.setAttribute('tabindex','0');svg.setAttribute('aria-label',`Heart rate chart, ${points.length} ${points.length===1?'sample':'samples'}, range ${Math.round(min)} to ${Math.round(max)} beats per minute, from ${new Date(first).toLocaleString()} to ${new Date(last).toLocaleString()}. Use left and right arrow keys to inspect samples.`);
  for(const value of [low,(low+high)/2,high]){const yy=y(value),line=node('line',{x1:36,x2:310,y1:yy,y2:yy,class:'chart-grid-line'}),label=node('text',{x:30,y:yy+3,'text-anchor':'end',class:'chart-axis-label'});label.textContent=String(Math.round(value));svg.append(line,label);}
  let path='',gaps=false;
  for(let i=0;i<points.length;i++){const p=points[i],separate=i===0||p.time-points[i-1].time>30*60*1000;if(i>0&&separate)gaps=true;path+=`${separate?'M':'L'}${x(p.time).toFixed(2)} ${y(p.value).toFixed(2)} `;}
  svg.append(node('path',{d:path,class:'chart-line'}));
  const stride=Math.max(1,Math.ceil(points.length/150));for(let i=0;i<points.length;i++){if(i%stride===0||i===points.length-1)svg.append(node('circle',{cx:x(points[i].time),cy:y(points[i].value),r:2.7,class:'chart-point'}));}
  const detail=document.createElement('p');detail.className='heart-chart-detail';detail.setAttribute('aria-live','polite');
  const hint='Hover, tap, or use arrow keys to inspect a sample.';detail.textContent=hint;
  const selectedPoint=node('circle',{r:4.5,class:'chart-selected-point',visibility:'hidden'});svg.append(selectedPoint);
  svg.append(node('rect',{x:0,y:0,width:320,height:160,fill:'transparent'}));
  let selectedIndex=-1;
  function showPoint(index){
    if(index===selectedIndex)return;
    selectedIndex=index;const point=points[index];
    selectedPoint.setAttribute('cx',String(x(point.time)));selectedPoint.setAttribute('cy',String(y(point.value)));selectedPoint.setAttribute('visibility','visible');
    detail.textContent=`${Math.round(point.value)} bpm · ${new Date(point.time).toLocaleString()}`;
  }
  function selectAtPointer(event){
    const rect=svg.getBoundingClientRect();if(!rect.width)return;
    const position=(event.clientX-rect.left)*320/rect.width;
    const fraction=Math.max(0,Math.min(1,(position-36)/274));
    const time=first+(last-first)*fraction;
    let lo=0,hi=points.length-1;
    while(lo<hi){const mid=Math.floor((lo+hi)/2);if(points[mid].time<time)lo=mid+1;else hi=mid;}
    const index=lo>0 && time-points[lo-1].time<=points[lo].time-time?lo-1:lo;
    showPoint(index);
  }
  svg.addEventListener('pointermove',selectAtPointer);
  svg.addEventListener('click',selectAtPointer);
  svg.addEventListener('focus',()=>showPoint(Math.max(0,selectedIndex)));
  svg.addEventListener('keydown',event=>{
    let next=Math.max(0,selectedIndex);
    if(event.key==='ArrowRight')next=Math.min(points.length-1,next+1);
    else if(event.key==='ArrowLeft')next=Math.max(0,next-1);
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=points.length-1;
    else return;
    event.preventDefault();showPoint(next);
  });
  container.append(svg);
  const range=document.createElement('div');range.className='heart-chart-range';
  const format=time=>new Date(time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const start=document.createElement('span');start.textContent=format(first);range.append(start);
  if(last!==first){const end=document.createElement('span');end.textContent=format(last);range.append(end);}container.append(range,detail);
  if(gaps){const note=document.createElement('p');note.className='heart-chart-note';note.textContent='Gaps over 30 minutes are not connected.';container.append(note);}
}
async function pollSession(){
  if(document.hidden||!selected||busy||dragging||sessionInFlight===selected)return;
  const side=selected, request=++sessionRequest;sessionInFlight=side;
  try{const data=await api(`/api/session?side=${encodeURIComponent(side)}`);if(selected!==side||request!==sessionRequest)return;sessionData=data.session;sessionSide=side;sessionCheckedAt=new Date().toISOString();$('session-error').textContent='';renderSession();}
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
// Device diagnostics refresh when the panel opens, rather than on a timer.
void pollDevice();
function syncCurrentDetail(){const item=sides.find(s=>s.side===selected);$('current-detail').hidden=!statusAvailable || !item || item.power===false || !Number.isInteger(item.current);}
async function readStatus(){try{return await api('/api/status');}catch(e){statusAvailable=false;syncCurrentDetail();throw e;}}
function update(data){statusAvailable=true;readOnly=data.readonly===true;if(data.pod_name)$('pod-name').textContent=data.pod_name;const previous=selected;sides=data.sides;if(!sides.some(s=>s.side===selected))selected=sides[0]?.side;if(selected!==previous){sessionRequest++;sessionInFlight=null;sessionData=null;sessionSide=null;void pollSession();}syncCurrentDetail();render();say('',true);}
async function refresh(){try{update(await readStatus());}catch(e){say(e.message);}}
let polling=false, revision=0;
async function pollStatus(){if(document.hidden||busy||dragging||polling)return;polling=true;const atStart=revision;try{const data=await readStatus();if(!busy&&!dragging&&revision===atStart)update(data);}catch(e){if(!busy&&!dragging)say(e.message);}finally{polling=false;}}
setInterval(pollStatus,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pollStatus();});
async function change(path, data){if(busy)return;revision++;busy=true;render();say('Updating…',true);try{update(await api(path,data));}catch(e){say(e.message);await refreshAfterError();}finally{busy=false;render();}}
async function refreshAfterError(){try{const data=await readStatus();sides=data.sides;statusAvailable=true;}catch{}}
function level(n){
  if(busy && !levelRunning)return;
  const raw=Math.max(-10,Math.min(10,n))*10, item=sides.find(s=>s.side===selected);
  if(!item || item.power===false)return;
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
$('slider').oninput=()=>{if($('slider').disabled)return;dragging=true;colorSlider(Number($('slider').value));$('value').textContent=displayLevel(Number($('slider').value)*10);$('estimate').textContent=`~${degrees(Number($('slider').value)*10)}`;};$('slider').onchange=()=>{dragging=false;level(Number($('slider').value));};
for(const event of ['pointerup','pointercancel','touchend','touchcancel','keyup'])$('slider').addEventListener(event,()=>setTimeout(()=>{if(dragging){dragging=false;render();}},0));$('power').onclick=()=>change('/api/power',{side:selected,on:!sides.find(s=>s.side===selected).power});$('unit-off').onclick=()=>applyTemperature('off',true);$('unit-f').onclick=()=>applyTemperature('F',true);$('unit-c').onclick=()=>applyTemperature('C',true);refresh();
function setSettingsOpen(open){$('settings-panel').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));}
$('settings-toggle').addEventListener('click',()=>setSettingsOpen($('settings-panel').hidden));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('settings-panel').hidden){setSettingsOpen(false);$('settings-toggle').focus();}});
// Drawers: Pod status slides out left of the control, session biometrics right. Escape, backdrop or × closes.
function setDrawer(id,open){const d=$(id);d.classList.toggle('open',open);d.setAttribute('aria-hidden',String(!open));const tab=id==='drawer-status'?$('tab-status'):$('tab-session');tab.setAttribute('aria-expanded',String(open));tab.classList.toggle('active',open);const any=document.querySelector('.drawer.open');$('drawer-backdrop').hidden=!any;if(open&&id==='drawer-status')void pollDevice();}
function toggleDrawer(id){const d=$(id);for(const other of document.querySelectorAll('.drawer'))if(other!==d&&other.classList.contains('open')&&window.matchMedia('(max-width:1199px)').matches)setDrawer(other.id,false);setDrawer(id,!d.classList.contains('open'));}
$('tab-status').onclick=()=>toggleDrawer('drawer-status');$('tab-session').onclick=()=>toggleDrawer('drawer-session');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>setDrawer(b.dataset.close,false);
$('drawer-backdrop').onclick=()=>{for(const d of document.querySelectorAll('.drawer.open'))setDrawer(d.id,false);};
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const d of document.querySelectorAll('.drawer.open'))setDrawer(d.id,false);});
for(const d of document.querySelectorAll('.drawer'))d.setAttribute('aria-hidden','true');
