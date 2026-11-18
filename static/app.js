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
// GET when there is no body, otherwise POST JSON. Errors carry the HTTP status.
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  } catch {
    throw Error('Can’t reach d8sleep. Check your connection.');
  }
  const data = await response.json();
  if (!response.ok) {
    const error = Error(data.error || 'Something went wrong.');
    error.status = response.status;
    throw error;
  }
  return data;
}
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
function render() {
  renderLive();
  renderSession();
  const item = sides.find(x => x.side === selected);
  if (!item) return;
  rememberSideLabels();
  renderSideButtons();
  const level = Number.isInteger(item.target) ? item.target : null;
  if (!dragging) {
    $('value').textContent = level === null ? '—' : displayLevel(level);
    $('slider').value = level === null ? 0 : Math.round(level / 10);
    colorSlider(Number($('slider').value));
  }
  $('current').textContent = Number.isInteger(item.current) ? displayLevel(item.current) : '';
  showCurrent(item.power === false ? null : item.current);
  syncCurrentDetail();
  const estimated = degrees(dragging ? Number($('slider').value) * 10 : level);
  $('estimate').textContent = estimated === '—' ? '—' : `~${estimated}`;
  $('power').textContent = item.power === null ? 'Power unavailable' : item.power ? 'On' : 'Off';
  rememberPowerLabel(item.power);
  $('power').setAttribute('aria-pressed', String(item.power === true));
  $('power').disabled = readOnly || busy || item.power === null;
  $('power').title = readOnly ? 'Read-only on this device' : '';
  syncSliderAvailability(item, level);
}
/** Left / Right buttons, shown only when the Pod has more than one side. */
function renderSideButtons() {
  $('sides').hidden = sides.length < 2;
  $('sides').replaceChildren();
  if (sides.length < 2) return;
  for (const s of sides) {
    const button = document.createElement('button');
    button.textContent = s.side[0].toUpperCase() + s.side.slice(1);
    button.className = s.side === selected ? 'active' : '';
    button.disabled = busy;
    button.onclick = () => { selected = s.side; resetSessionView(); render(); void pollSession(); };
    $('sides').append(button);
  }
}
/** Forget the loaded session so a different side starts from its newest night. */
function resetSessionView() {
  sessionRequest++;
  sessionInFlight = null;
  sessionData = null;
  sessionSide = null;
  nightIndex = 0;
}
function choiceList(options,current){
  const chips=document.createElement('div');chips.className='choices';
  const list=options.slice();if(current!==null&&current!==undefined&&!list.some(o=>o[0]===current))list.push([current,String(current)]);
  for(const [value,text] of list){const chip=document.createElement('em');chip.textContent=text;if(value===current){chip.className='on';chip.setAttribute('aria-current','true');}chips.append(chip);}
  return chips;
}
function whenShort(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString();}
function renderLive(){
  const strip=$('status-strip'), hero=$('live-status'), details=$('live-details'), d=deviceData, side=sides.find(s=>s.side===selected);
  strip.replaceChildren();hero.replaceChildren();details.replaceChildren();
  const level=value=>Number.isInteger(value)?displayLevel(value):'—';
  const yesNo=(value,yes='Yes',no='No')=>typeof value==='boolean'?(value?yes:no):'—';
  const tag=(text,state)=>{const item=document.createElement('span'),dot=document.createElement('i'),label=document.createElement('span');item.className='status-tag';dot.className=state===true?'status-tag-dot good':state===false?'status-tag-dot bad':'status-tag-dot';dot.setAttribute('aria-hidden','true');label.textContent=text;item.append(dot,label);strip.append(item);};
  tag(yesNo(d?.online,'Online','Offline')==='—'?'Connection unknown':yesNo(d?.online,'Online','Offline'),d?.online);
  tag(yesNo(d?.hasWater,'Water','Water low / absent')==='—'?'Water unknown':yesNo(d?.hasWater,'Water','Water low / absent'),d?.hasWater);
  $('pod-side-heading').textContent=side?.side?`This side · ${side.side.charAt(0).toUpperCase()+side.side.slice(1)}`:'This side';
  const card=(title)=>{const box=document.createElement('div'),label=document.createElement('span');box.className='bento-card';label.className='bento-label';label.textContent=title;box.append(label);return box;};
  const line=(box,value,cls)=>{const text=document.createElement('span');text.className=cls;text.textContent=value;box.append(text);};
  const modes=[['off','Off'],['smart:bedtime','Bedtime'],['smart:initial','Early sleep'],['smart:final','Late sleep']];
  const modeLabels={'off':'Off','smart:bedtime':'Bedtime','smart:initial':'Early sleep','smart:final':'Late sleep'};
  const mode=modeLabels[side?.mode]||side?.mode||'—';
  const active=card('Active state');
  line(active,side?.power===false?'Off':side?.power===true?`On · ${mode}`:'Power unknown',side?.power===true?'bento-value active':'bento-value');
  const powerChoices=choiceList([[false,'Off'],[true,'On']],typeof side?.power==='boolean'?side.power:null);powerChoices.setAttribute('role','group');powerChoices.setAttribute('aria-label','Power states');active.append(powerChoices);
  const modeChoices=choiceList(modes,side?.mode||null);modeChoices.setAttribute('role','group');modeChoices.setAttribute('aria-label','Known modes');active.append(modeChoices);
  line(active,`Started ${when(side?.mode_started)}`,'bento-subtext');hero.append(active);
  const thermal=card('Thermal');line(thermal,level(side?.target),'bento-value');
  const running=side?.side==='left'?d?.leftNowHeating:side?.side==='right'?d?.rightNowHeating:null;
  line(thermal,`Currently ${side?.power===false?'—':level(side?.current)} · Running: ${yesNo(running)}`,'bento-subtext');
  const schedule=choiceList([['smart','Smart'],['timeBased','Timed']],side?.schedule_type||null);schedule.setAttribute('role','group');schedule.setAttribute('aria-label','Schedule types');thermal.append(schedule);hero.append(thermal);
  // Grouped cards: each group has titled rows, and each row is a grid of label-over-value cells.
  const section=(title)=>{const group=document.createElement('section'),heading=document.createElement('h3'),body=document.createElement('div');heading.className='pod-section-heading';heading.textContent=title;body.className='pod-group';group.append(heading,body);details.append(group);return body;};
  const row=(parent,title,cells,columns=cells.length)=>{const item=document.createElement('div'),name=document.createElement('span'),grid=document.createElement('div');
    item.className='pod-row';name.className='pod-row-title';name.textContent=title;grid.className='pod-kv-grid';grid.style.setProperty('--cols',String(columns));
    for(const [label,value] of cells){const cell=document.createElement('div'),key=document.createElement('span'),text=document.createElement('strong');cell.className='pod-kv';key.textContent=label;text.textContent=value;cell.append(key,text);grid.append(cell);}
    item.append(name,grid);parent.append(item);};
  const presets=section('Schedule presets');
  row(presets,'Smart schedule',[['Bedtime',level(side?.smart?.bedTimeLevel)],['Early sleep',level(side?.smart?.initialSleepLevel)],['Late sleep',level(side?.smart?.finalSleepLevel)]]);
  row(presets,'Timed mode',[['Timed level',level(side?.timed?.level)],['Duration',formatDuration(side?.timed?.durationSeconds)]],3); // same 3 columns as Smart schedule, so Duration sits under Early sleep
  const hardware=section('Pod hardware & system');
  row(hardware,'Water & priming',[['Priming',yesNo(d?.priming,'In progress','Not running')],['Needs priming',yesNo(d?.needsPriming)],['Last primed',whenShort(d?.lastPrime)]]);
  row(hardware,'Connectivity & firmware',[['Last heard',whenShort(d?.lastHeard)],['Firmware',d?.firmwareVersion||'—'],['Firmware updating',yesNo(d?.firmwareUpdating)]]);
}
let sessionRequest=0, sessionInFlight=null, sessionCheckedAt=null;
// --- Session summary ---
let nightIndex=0;
const STAGE_DEFS=[['deep','Deep'],['rem','REM'],['light','Light'],['awake','Awake']];
const SUMMARY_STREAMS=[['heartRate','HR',' bpm'],['hrv','HRV',' ms'],['respiratoryRate','Resp',' brpm'],['tempBedC','Bed',''],['tempRoomC','Room','']];
function formatDuration(seconds){if(!Number.isFinite(seconds)||seconds<0)return '—';const minutes=Math.round(seconds/60),hours=Math.floor(minutes/60);return hours?`${hours}h ${String(minutes%60).padStart(2,'0')}m`:`${minutes}m`;}
function clockTime(value){const ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'—';}
function dayLabel(value){const ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';}
function nightLabel(night){const start=dayLabel(night?.sleep_start||night?.start),end=dayLabel(night?.sleep_end||night?.presence_end);if(!start)return 'No session';return end&&end!==start?`${start} – ${end}`:start;}
function nightList(session){const list=Array.isArray(session?.sessions)&&session.sessions.length?session.sessions:(session?[session]:[]);if(nightIndex>=list.length)nightIndex=Math.max(0,list.length-1);return list;}
function seriesStats(night,key){const values=(Array.isArray(night?.series?.[key])?night.series[key]:[]).map(p=>p&&p.value).filter(v=>typeof v==='number'&&Number.isFinite(v));if(!values.length)return null;let min=Infinity,max=-Infinity,sum=0;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);sum+=v;}return {avg:sum/values.length,min,max};}
function summaryParts(key, suffix, stats) {
  if (!stats) return { avg: '—', range: 'No data' };
  const format = value => isTempStream(key) ? String(Math.round(chartNumber(key, value)))
    : key === 'respiratoryRate' ? chartNumber(key, value).toFixed(1)
    : String(Math.round(value));
  const unitTail = isTempStream(key) ? `°${unit === 'F' ? 'F' : 'C'}` : suffix;
  const rangeTail = isTempStream(key) ? '°' : '';
  return { avg: `${format(stats.avg)}${unitTail}`, range: `${format(stats.min)}–${format(stats.max)}${rangeTail}` };
}
function stageTotals(night){const totals={deep:0,rem:0,light:0,awake:0};for(const s of Array.isArray(night?.stages)?night.stages:[])if(s&&s.stage in totals&&Number.isFinite(s.duration))totals[s.stage]+=s.duration;return totals;}
function renderNightSwitcher(list){
  const box=$('night-switcher'),signature=JSON.stringify([selected,list.map(n=>[n?.start,n?.sleep_start,n?.sleep_end,n?.presence_end])]);
  if(box.children[0]?.open&&box.children[0]._nightKeys===signature)return;
  box.replaceChildren();box.hidden=list.length<2;if(list.length<2)return;
  const menu=document.createElement('details'),label=document.createElement('summary'),choices=document.createElement('select');
  menu.className='night-menu';menu._nightKeys=signature;const labels=list.map(nightLabel),uniqueLabel=index=>labels.filter(value=>value===labels[index]).length>1?`${labels[index]} · ${clockTime(list[index]?.sleep_start||list[index]?.start)}`:labels[index];
  label.className='night-label';label.setAttribute('aria-label',`Choose session: ${uniqueLabel(nightIndex)}`);label.textContent=uniqueLabel(nightIndex);
  choices.className='night-options';choices.size=Math.min(10,list.length);choices.setAttribute('aria-label','Choose session, newest first');
  list.forEach((night,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=uniqueLabel(index);option.selected=index===nightIndex;choices.append(option);});
  const commit=()=>{const index=Number(choices.value);if(!Number.isInteger(index)||index<0||index>=list.length)return;nightIndex=index;menu.open=false;renderSession();box.querySelector?.('summary')?.focus();};
  choices.addEventListener('change',commit);
  const STEPS = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
  choices.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); menu.open = false; label.focus(); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commit(); return; }
    // Arrows, Page Up/Down, Home and End move within the list; Enter commits.
    if (event.key in STEPS || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const last = list.length - 1;
      choices.selectedIndex = event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, choices.selectedIndex + STEPS[event.key]));
    }
  });
  menu.append(label,choices);box.append(menu);
}
document.addEventListener?.('click',event=>{const box=$('night-switcher');if(box&&!box.contains?.(event.target)){const menu=box.querySelector?.('.night-menu');if(menu)menu.open=false;}});
function renderStages(night){
  const box=$('session-stages-content');box.replaceChildren();
  const totals=stageTotals(night),all=STAGE_DEFS.reduce((sum,[k])=>sum+totals[k],0);
  if(!all){const empty=document.createElement('p');empty.className='heart-chart-empty';empty.textContent='No sleep stages for this night.';box.append(empty);return;}
  const bar=document.createElement('div');bar.className='stage-bar';bar.setAttribute('role','img');
  bar.setAttribute('aria-label',`Sleep stages: ${STAGE_DEFS.map(([k,l])=>`${l} ${formatDuration(totals[k])}`).join(', ')}`);
  const blocks=(night.stages||[]).filter(s=>s&&Number.isFinite(s.duration)&&s.duration>0),span=blocks.reduce((sum,s)=>sum+s.duration,0)||1;
  for(const s of blocks){const seg=document.createElement('span');seg.className=`stage-seg stage-${s.stage}`;seg.style.width=`${s.duration/span*100}%`;if(s.stage in chartPrefs.stageColors)seg.style.background=chartPrefs.stageColors[s.stage];bar.append(seg);}
  const legend=document.createElement('div');legend.className='stage-legend';
  for(const [key,label] of STAGE_DEFS){const item=document.createElement('span'),dot=document.createElement('i');
    item.className='stage-legend-item';dot.className='chart-chip-dot';dot.style.background=chartPrefs.stageColors[key];item.append(dot,document.createTextNode(`${label} ${formatDuration(totals[key])} (${Math.round(totals[key]/all*100)}%)`));legend.append(item);}
  box.append(bar,legend);
}
function renderStageColors(){
  const box=$('stage-colors');box.replaceChildren();
  for(const [key,label] of STAGE_DEFS){const row=document.createElement('label'),text=document.createElement('span'),input=document.createElement('input');
    row.className='chart-color-row';text.textContent=label;input.type='color';input.value=chartPrefs.stageColors[key];input.disabled=readOnly;input.setAttribute('aria-label',`${label} color`);
    input.addEventListener('input',()=>{chartPrefs.stageColors[key]=input.value;saveChartPrefs();renderSession();});row.append(text,input);box.append(row);}
  const reset=document.createElement('button');reset.type='button';reset.className='chart-colors-reset';reset.textContent='Reset defaults';reset.disabled=readOnly;
  reset.addEventListener('click',()=>{chartPrefs.stageColors={...STAGE_DEFAULT_COLORS};saveChartPrefs();renderStageColors();renderSession();});box.append(reset);
}
function renderScoreRing(box,score){
  box.replaceChildren();const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),has=Number.isFinite(score);
  const node=(name,attrs)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
  svg.setAttribute('viewBox','0 0 56 56');svg.setAttribute('aria-hidden','true');
  svg.append(node('circle',{cx:28,cy:28,r:24,class:'score-ring-track'}));
  if(has){const c=2*Math.PI*24;svg.append(node('circle',{cx:28,cy:28,r:24,class:'score-ring-arc','stroke-dasharray':`${(Math.max(0,Math.min(100,score))/100*c).toFixed(1)} ${c.toFixed(1)}`,transform:'rotate(-90 28 28)'}));}
  const label=document.createElement('span');label.className='score-ring-value';label.textContent=has?String(Math.round(score)):'—';
  box.setAttribute('aria-label',has?`Sleep score ${Math.round(score)}`:'Sleep score not reported');box.append(svg,label);
}
function renderSession(){
  const session=sessionSide===selected?sessionData:null,list=nightList(session),night=list[nightIndex]||null;
  $('session-updated').textContent=[selected?`${selected.charAt(0).toUpperCase()+selected.slice(1)} side`:'',sessionSide===selected&&sessionCheckedAt?`Checked ${when(sessionCheckedAt)}`:''].filter(Boolean).join(' · ');
  renderNightSwitcher(list);
  const pill=$('session-state');pill.replaceChildren();pill.hidden=typeof night?.incomplete!=='boolean';
  if(!pill.hidden){const dot=document.createElement('i'),text=document.createElement('span');
    dot.className=night.incomplete?'status-tag-dot pending':'status-tag-dot good';dot.setAttribute('aria-hidden','true');text.textContent=night.incomplete?'Incomplete':'Complete';pill.append(dot,text);}
  const totals=stageTotals(night),asleep=Number.isFinite(night?.stage_summary?.sleepDuration)?night.stage_summary.sleepDuration:(totals.deep+totals.rem+totals.light||null);
  renderScoreRing($('summary-score'),night?.score);
  $('summary-asleep').textContent=Number.isFinite(asleep)?`${formatDuration(asleep)} asleep`:'Asleep —';
  const inBed=Number.isFinite(night?.duration)?night.duration:night?.stage_summary?.totalDuration,window=night?.sleep_start&&night?.sleep_end?`${clockTime(night.sleep_start)} – ${clockTime(night.sleep_end)}`:'';
  $('summary-window').textContent=[window,Number.isFinite(inBed)?`${formatDuration(inBed)} in bed`:''].filter(Boolean).join(' · ')||'Sleep window not reported';
  renderStages(night);
  const bio=$('session-bio');bio.replaceChildren();
  for(const [key] of orderedStreams()){const [,label,suffix]=SUMMARY_STREAMS.find(x=>x[0]===key);const cell=document.createElement('div'),name=document.createElement('span'),value=document.createElement('strong'),range=document.createElement('small'),parts=summaryParts(key,suffix,seriesStats(night,key));
    cell.className='bio-cell';name.textContent=label;value.textContent=parts.avg;range.textContent=parts.range;cell.append(name,value,range);bio.append(cell);}
  renderSessionChart(night);
}
// --- Session chart ---
const CHART_STREAMS=[['heartRate','Heart Rate','HR'],['hrv','HRV','HRV'],['tempBedC','Bed Temp','Bed'],['respiratoryRate','Resp Rate','Resp'],['tempRoomC','Room Temp','Room']];
const CHART_DEFAULT_COLORS={heartRate:'#e57373',hrv:'#64b5f6',tempBedC:'#ffb74d',respiratoryRate:'#4db6ac',tempRoomC:'#9575cd'};
const CHART_GAP_MS=30*60*1000, CHART_MATCH_MS=10*60*1000;
function chartStep(points){if(points.length<2)return 0;const gaps=[];for(let i=1;i<points.length;i++)gaps.push(points[i].time-points[i-1].time);gaps.sort((a,b)=>a-b);return gaps[Math.floor(gaps.length/2)];}
const STAGE_DEFAULT_COLORS={deep:'#5c6bc0',rem:'#ba68c8',light:'#4fc3f7',awake:'#ffb74d'};
let chartPrefs={colors:{...CHART_DEFAULT_COLORS},active:['heartRate'],stageColors:{...STAGE_DEFAULT_COLORS},order:CHART_STREAMS.map(s=>s[0])}, chartSession=null, chartSaveTimer=null;
// The user's chosen order of the five indicators; chips, the colour list, the readout and the nightly strip all follow it.
function orderedStreams(){const rank=new Map(chartPrefs.order.map((k,i)=>[k,i]));return [...CHART_STREAMS].sort((a,b)=>(rank.has(a[0])?rank.get(a[0]):99)-(rank.has(b[0])?rank.get(b[0]):99));}
function moveStream(key,toIndex){const rest=chartPrefs.order.filter(k=>k!==key);rest.splice(Math.max(0,Math.min(rest.length,toIndex)),0,key);chartPrefs.order=rest;}
function isTempStream(key){return key==='tempBedC'||key==='tempRoomC';}
function chartNumber(key,value){return isTempStream(key)&&unit==='F'?value*9/5+32:value;}
function chartText(key,value){const n=chartNumber(key,value);if(isTempStream(key))return `${Math.round(n)}°${unit==='F'?'F':'C'}`;return key==='respiratoryRate'?n.toFixed(1):String(Math.round(n));}
function chartPoints(session,key){const raw=session?.series?.[key]??(key==='heartRate'?session?.heart_rate_series:null);return (Array.isArray(raw)?raw:[]).filter(p=>p&&typeof p.value==='number'&&Number.isFinite(p.value)&&typeof p.timestamp==='string'&&Number.isFinite(Date.parse(p.timestamp))).map(p=>({time:Date.parse(p.timestamp),value:p.value})).sort((a,b)=>a.time-b.time);}
function nearestIndex(list,time,get){let lo=0,hi=list.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(get(list[mid])<time)lo=mid+1;else hi=mid;}return lo>0&&time-get(list[lo-1])<=get(list[lo])-time?lo-1:lo;}
/** Turns whatever the server stored into a complete, valid preferences object. */
function normalizeChartPrefs(raw) {
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const known = CHART_STREAMS.map(s => s[0]);
  const pickColors = (defaults, given) => {
    const colors = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = given?.[key];
      if (typeof value === 'string' && HEX.test(value)) colors[key] = value.toLowerCase();
    }
    return colors;
  };
  const colors = pickColors(CHART_DEFAULT_COLORS, raw?.colors);
  const stageColors = pickColors(STAGE_DEFAULT_COLORS, raw?.stageColors);
  const active = Array.isArray(raw?.active) ? known.filter(k => raw.active.includes(k)) : ['heartRate'];
  const wanted = Array.isArray(raw?.order) ? raw.order.filter((k, i, all) => known.includes(k) && all.indexOf(k) === i) : [];
  const order = [...wanted, ...known.filter(k => !wanted.includes(k))];   // anything left out keeps its default place at the end
  return { colors, active, stageColors, order };
}
function renderSessionChart(session){
  if(session!==undefined)chartSession=session;
  const container=$('heart-chart-content'),readout=$('chart-readout'),chips=$('chart-chips');container.replaceChildren();chips.replaceChildren();readout.textContent='';
  const data={};for(const [key] of CHART_STREAMS)data[key]=chartPoints(chartSession,key);
  for(const [key,label] of orderedStreams()){
    const chip=document.createElement('button'),dot=document.createElement('i'),text=document.createElement('span'),on=chartPrefs.active.includes(key);
    chip.type='button';chip.className='chart-chip';chip.setAttribute('aria-pressed',String(on));dot.className='chart-chip-dot';dot.style.background=chartPrefs.colors[key];text.textContent=label;chip.append(dot,text);
    if(!data[key].length)chip.title='No samples in this session';
    chip.addEventListener('click',()=>{chartPrefs.active=on?chartPrefs.active.filter(k=>k!==key):CHART_STREAMS.map(s=>s[0]).filter(k=>k===key||chartPrefs.active.includes(k));saveChartPrefs();renderSessionChart();});
    chips.append(chip);
  }
  const active=orderedStreams().filter(s=>chartPrefs.active.includes(s[0])&&data[s[0]].length);
  if(!active.length){const empty=document.createElement('p');empty.className='heart-chart-empty';empty.textContent=chartPrefs.active.length?'No samples for the selected indicators in this session.':'Choose an indicator above.';container.append(empty);return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  const node=(name,attrs)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
  let first=Infinity,last=-Infinity;const times=new Set();
  for(const [key] of active)for(const p of data[key]){first=Math.min(first,p.time);last=Math.max(last,p.time);times.add(p.time);}
  const sorted=[...times].sort((a,b)=>a-b),single=active.length===1;
  const x=time=>first===last?173:36+(time-first)/(last-first)*274;
  const scale={};
  for(const [key] of active){let min=Infinity,max=-Infinity;for(const p of data[key]){const n=chartNumber(key,p.value);min=Math.min(min,n);max=Math.max(max,n);}
    if(single){const pad=Math.max((max-min)*0.1,key==='respiratoryRate'||isTempStream(key)?0.5:5);min-=pad;max+=pad;}
    scale[key]={min,max,y:value=>{const n=chartNumber(key,value);return max===min?76:140-(n-min)/(max-min)*128;}};}
  svg.setAttribute('viewBox','0 0 320 160');svg.setAttribute('role','img');svg.setAttribute('tabindex','0');
  svg.setAttribute('aria-label',`Session chart of ${active.map(s=>s[1]).join(', ')}, from ${new Date(first).toLocaleString()} to ${new Date(last).toLocaleString()}. Use left and right arrow keys to inspect the session.`);
  for(const fraction of [0,0.5,1]){const yy=140-fraction*128;svg.append(node('line',{x1:36,x2:310,y1:yy,y2:yy,class:'chart-grid-line'}));
    if(single){const s=scale[active[0][0]],value=s.min+(s.max-s.min)*fraction,label=node('text',{x:30,y:yy+3,'text-anchor':'end',class:'chart-axis-label'});label.textContent=(s.max-s.min)<10?value.toFixed(1):String(Math.round(value));svg.append(label);}}
  let gaps=false;
  for(const [key] of active){let path='';const pts=data[key],gapLimit=Math.max(CHART_GAP_MS,3*chartStep(pts));for(let i=0;i<pts.length;i++){const split=i===0||pts[i].time-pts[i-1].time>gapLimit;if(i>0&&split)gaps=true;path+=`${split?'M':'L'}${x(pts[i].time).toFixed(2)} ${scale[key].y(pts[i].value).toFixed(2)} `;}
    const line=node('path',{d:path,class:'chart-line chart-series'});line.style.stroke=chartPrefs.colors[key];svg.append(line);
    pts.forEach((p,i)=>{const alone=(i===0||p.time-pts[i-1].time>gapLimit)&&(i===pts.length-1||pts[i+1].time-p.time>gapLimit);if(alone||pts.length<=40){const dot=node('circle',{cx:x(p.time),cy:scale[key].y(p.value),r:2.2,class:'chart-point'});dot.style.fill=chartPrefs.colors[key];svg.append(dot);}});}
  const cross=node('line',{y1:12,y2:140,class:'chart-crosshair',visibility:'hidden'});svg.append(cross);
  const markers=active.map(([key])=>{const m=node('circle',{r:4,class:'chart-selected-point',visibility:'hidden'});m.style.fill=chartPrefs.colors[key];svg.append(m);return m;});
  svg.append(node('rect',{x:0,y:0,width:320,height:160,fill:'transparent'}));
  const hint='Hover, tap, or use arrow keys to inspect the session.';readout.textContent=hint;
  let selectedIndex=-1;
  function showIndex(index){
    if(index===selectedIndex)return;selectedIndex=index;const time=sorted[index];
    cross.setAttribute('x1',String(x(time)));cross.setAttribute('x2',String(x(time)));cross.setAttribute('visibility','visible');
    const parts=[];
    active.forEach(([key,,short],i)=>{const pts=data[key],j=nearestIndex(pts,time,p=>p.time),p=pts[j];
      if(p&&Math.abs(p.time-time)<=Math.max(CHART_MATCH_MS,0.6*chartStep(pts))){parts.push(`${short} ${chartText(key,p.value)}`);markers[i].setAttribute('cx',String(x(p.time)));markers[i].setAttribute('cy',String(scale[key].y(p.value)));markers[i].setAttribute('visibility','visible');}
      else{parts.push(`${short} —`);markers[i].setAttribute('visibility','hidden');}});
    readout.textContent=`${new Date(time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · ${parts.join(' · ')}`;
  }
  function selectAtPointer(event){const rect=svg.getBoundingClientRect();if(!rect.width)return;const position=(event.clientX-rect.left)*320/rect.width,fraction=Math.max(0,Math.min(1,(position-36)/274));showIndex(nearestIndex(sorted,first+(last-first)*fraction,t=>t));}
  svg.addEventListener('pointermove',selectAtPointer);svg.addEventListener('click',selectAtPointer);
  svg.addEventListener('focus',()=>showIndex(Math.max(0,selectedIndex)));
  svg.addEventListener('keydown',event=>{let next=Math.max(0,selectedIndex);
    if(event.key==='ArrowRight')next=Math.min(sorted.length-1,next+1);else if(event.key==='ArrowLeft')next=Math.max(0,next-1);else if(event.key==='Home')next=0;else if(event.key==='End')next=sorted.length-1;else return;
    event.preventDefault();showIndex(next);});
  container.append(svg);
  const range=document.createElement('div');range.className='heart-chart-range';
  const format=time=>new Date(time).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  const start=document.createElement('span');start.textContent=format(first);range.append(start);
  if(last!==first){const end=document.createElement('span');end.textContent=format(last);range.append(end);}container.append(range);
  if(gaps){const note=document.createElement('p');note.className='heart-chart-note';note.textContent='Unusually long gaps in a stream are not connected.';container.append(note);}
}
function commitStreamOrder(){saveChartPrefs();renderChartColors();if(typeof renderSession==='function')renderSession();else renderSessionChart();}
// Drag a row by its handle (mouse or touch) to reorder; the handle also takes the arrow keys.
function attachRowDrag(handle,row,box,key){
  // Grab anywhere on the row except its colour swatch. Moving the row in the DOM drops pointer capture,
  // so the move/up listeners live on the document rather than on the element being moved.
  row.addEventListener('pointerdown',event=>{
    if(readOnly||event.button>0||(event.target&&event.target.closest&&event.target.closest('input')))return;
    event.preventDefault();row.className+=' dragging';
    const rows=()=>[...box.querySelectorAll('.chart-color-row')];
    const move=e=>{const list=rows();let target=list.length-1;for(let i=0;i<list.length;i++){const r=list[i].getBoundingClientRect();if(e.clientY<r.top+r.height/2){target=i;break;}}
      const current=list.indexOf(row);if(target!==current)box.insertBefore(row,target>current?list[target].nextSibling:list[target]);};
    const end=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);row.className=row.className.replace(' dragging','');
      const order=rows().map(r=>r._key);if(order.join()!==chartPrefs.order.join()){chartPrefs.order=order;commitStreamOrder();}};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  });
  handle.addEventListener('keydown',event=>{
    if(readOnly||(event.key!=='ArrowUp'&&event.key!=='ArrowDown'))return;event.preventDefault();
    moveStream(key,chartPrefs.order.indexOf(key)+(event.key==='ArrowUp'?-1:1));commitStreamOrder();
    const again=[...box.querySelectorAll('.chart-color-row')].find(r=>r._key===key);if(again&&again._handle)again._handle.focus();
  });
}
function renderChartColors(){
  const box=$('chart-colors');box.replaceChildren();
  for(const [key,label] of orderedStreams()){const row=document.createElement('div'),handle=document.createElement('button'),text=document.createElement('span'),input=document.createElement('input');
    row.className='chart-color-row';row._key=key;row._handle=handle;
    handle.type='button';handle.className='drag-handle';handle.textContent='⋮⋮';handle.disabled=readOnly;handle.title='Drag to reorder';handle.setAttribute('aria-label',`Move ${label}. Drag, or use the up and down arrow keys.`);
    text.textContent=label;text.className='chart-color-name';input.type='color';input.value=chartPrefs.colors[key];input.disabled=readOnly;input.setAttribute('aria-label',`${label} color`);
    input.addEventListener('input',()=>{chartPrefs.colors[key]=input.value;saveChartPrefs();renderSessionChart();});
    attachRowDrag(handle,row,box,key);row.append(handle,text,input);box.append(row);}
  const reset=document.createElement('button');reset.type='button';reset.className='chart-colors-reset';reset.textContent='Reset defaults';reset.disabled=readOnly;
  reset.addEventListener('click',()=>{chartPrefs.colors={...CHART_DEFAULT_COLORS};chartPrefs.order=CHART_STREAMS.map(s=>s[0]);commitStreamOrder();});box.append(reset);
}
function sendChartPrefs(){clearTimeout(chartSaveTimer);chartSaveTimer=null;if(readOnly)return;fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(chartPrefs)}).catch(()=>{});}
function saveChartPrefs(){clearTimeout(chartSaveTimer);chartSaveTimer=setTimeout(sendChartPrefs,300);}
// Colour pickers: closing one (outside click, Escape, or its button) saves immediately instead of waiting out the debounce.
const COLOR_POPOVERS=[['chart-colors','chart-colors-btn'],['stage-colors','stage-colors-btn']];
function closeColorPopovers(){let closed=false;for(const [boxId,buttonId] of COLOR_POPOVERS){const box=$(boxId);if(box&&!box.hidden){box.hidden=true;$(buttonId).setAttribute('aria-expanded','false');closed=true;}}if(closed)sendChartPrefs();return closed;}
function toggleColorPopover(boxId,buttonId,render){const box=$(boxId),opening=box.hidden;closeColorPopovers();if(opening){render();box.hidden=false;$(buttonId).setAttribute('aria-expanded','true');}}
async function loadChartPrefs(){try{const data=await api('/api/prefs');chartPrefs=normalizeChartPrefs(data.prefs);}catch{}renderChartColors();renderStageColors();renderSession();}
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
function update(data) {
  statusAvailable = true;
  readOnly = data.readonly === true;
  if (data.pod_name) $('pod-name').textContent = data.pod_name;
  const previous = selected;
  sides = data.sides;
  if (!sides.some(s => s.side === selected)) selected = sides[0]?.side;
  if (selected !== previous) { resetSessionView(); void pollSession(); }
  syncCurrentDetail();
  render();
  say('', true);
}
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
for (const event of ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'keyup']) {
  $('slider').addEventListener(event, () => setTimeout(() => { if (dragging) { dragging = false; render(); } }, 0));
}
$('power').onclick = () => change('/api/power', { side: selected, on: !sides.find(s => s.side === selected).power });
$('unit-off').onclick = () => applyTemperature('off', true);
$('unit-f').onclick = () => applyTemperature('F', true);
$('unit-c').onclick = () => applyTemperature('C', true);
refresh();
function setSettingsOpen(open){$('settings-panel').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));}
$('settings-toggle').addEventListener('click',()=>setSettingsOpen($('settings-panel').hidden));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('settings-panel').hidden){setSettingsOpen(false);$('settings-toggle').focus();}});
// Drawers: Pod status slides out left of the control, session biometrics right. Escape, backdrop or × closes.
function setDrawer(id,open){const d=$(id);d.classList.toggle('open',open);d.setAttribute('aria-hidden',String(!open));const tab=id==='drawer-status'?$('tab-status'):$('tab-session');tab.setAttribute('aria-expanded',String(open));tab.classList.toggle('active',open);const any=document.querySelector('.drawer.open');$('drawer-backdrop').hidden=!any;if(open&&id==='drawer-status')void pollDevice();}
function toggleDrawer(id){const d=$(id);for(const other of document.querySelectorAll('.drawer'))if(other!==d&&other.classList.contains('open')&&window.matchMedia('(max-width:1199px)').matches)setDrawer(other.id,false);setDrawer(id,!d.classList.contains('open'));}
$('tab-status').onclick=()=>toggleDrawer('drawer-status');$('tab-session').onclick=()=>toggleDrawer('drawer-session');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>setDrawer(b.dataset.close,false);
$('drawer-backdrop').onclick=()=>{for(const d of document.querySelectorAll('.drawer.open'))setDrawer(d.id,false);};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(closeColorPopovers())return;for(const d of document.querySelectorAll('.drawer.open'))setDrawer(d.id,false);}});
for(const d of document.querySelectorAll('.drawer'))d.setAttribute('aria-hidden','true');
$('chart-colors-btn').onclick=()=>toggleColorPopover('chart-colors','chart-colors-btn',renderChartColors);
$('stage-colors-btn').onclick=()=>toggleColorPopover('stage-colors','stage-colors-btn',renderStageColors);
document.addEventListener('click',event=>{if(event.target.closest&&event.target.closest('#chart-colors,#stage-colors,#chart-colors-btn,#stage-colors-btn'))return;closeColorPopovers();});
// Load the saved chart preferences (colors, indicators, order, stage colors) once the page is ready.
void loadChartPrefs();
