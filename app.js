import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const START_HOUR = 7, END_HOUR = 23, ROW_HEIGHT = 52;
const COLORS = [
  ['#3d5a80','#e7edf5'], ['#477b58','#e5f0e7'], ['#a9671d','#fff0d9'],
  ['#806b9b','#eee8f5'], ['#b34e5a','#f8e7e9'], ['#338387','#e2f2f1']
];
// Read the URL before Supabase clears it, so we know if the user arrived from a password-reset email.
const urlHash = new URLSearchParams(window.location.hash.slice(1));
const openedFromResetLink = urlHash.get('type') === 'recovery';
const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR_') && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes('YOUR_');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

let session = null;
let authMode = 'signin';
let tasks = [];
let occurrences = [];
let weekOffset = 0;
let activeView = 'calendar';
let dragOccurrenceId = null;
let resizing = null;
let toastTimer = null;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function parseDate(key) { return new Date(`${key}T00:00:00`); }
function addDays(key, amount) { const d = parseDate(key); d.setDate(d.getDate()+amount); return localDateKey(d); }
function mondayOf(date = new Date()) { const d = new Date(date); const weekday = d.getDay(); d.setDate(d.getDate() + (weekday === 0 ? -6 : 1-weekday)); d.setHours(0,0,0,0); return d; }
function weekDates(offset = 0) { const monday = mondayOf(); monday.setDate(monday.getDate()+offset*7); return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return localDateKey(d);}); }
function timeToMinutes(value) { if (!value) return null; const [h,m='0'] = value.split(':'); return Number(h)*60+Number(m.slice(0,2)); }
function minutesToTime(minutes) { const safe=Math.max(0,Math.min(1439,Math.round(minutes/30)*30)); return `${String(Math.floor(safe/60)).padStart(2,'0')}:${String(safe%60).padStart(2,'0')}:00`; }
function displayTime(value) { const m=timeToMinutes(value); if(m===null) return 'Unscheduled'; const h=Math.floor(m/60), mins=m%60; return `${h%12||12}${mins?':'+String(mins).padStart(2,'0'):''} ${h>=12?'PM':'AM'}`; }
function formatDate(key, options={month:'short',day:'numeric'}) { return key ? parseDate(key).toLocaleDateString(undefined,options) : 'Unscheduled'; }
function taskFor(occ) { return tasks.find(t=>t.id===occ.task_id); }
function isRecurring(task) { return Array.isArray(task?.recurrence_days) && task.recurrence_days.length > 0; }
function titleFor(occ) { return taskFor(occ)?.title || 'Untitled task'; }
function colorFor(occ) { const title=titleFor(occ); let hash=0; for(const c of title) hash=(hash*31+c.charCodeAt(0))|0; return COLORS[Math.abs(hash)%COLORS.length]; }
function showToast(message, isError=false) { const el=$('#appMessage'); el.textContent=message; el.classList.toggle('error',isError); el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3800); }
function setSync(text, error=false) { const el=$('#syncStatus'); el.textContent=text; el.style.color=error?'var(--red)':''; }
function requireSupabase() { if (!supabase) { setSync('Setup required',true); showToast('Add your Supabase project URL and publishable/anon key to config.js first.',true); return false; } return true; }
// [heading, description, submit button, switch text, switch button, busy button text] for each login screen mode.
const AUTH_TEXT = {
  signin: ['Welcome back','Sign in to access your calendar and tasks.','Sign in','New to Settle?','Create an account','Signing in…'],
  signup: ['Create your account','Create an account to keep your tasks private and synced.','Create account','Already have an account?','Sign in','Creating…'],
  forgot: ['Reset your password',"Enter your account's email and we'll send you a link to choose a new password.",'Send reset link','Remembered it?','Back to sign in','Sending…'],
  recovery: ['Choose a new password','Enter a new password for your Settle account.','Update password','','','Saving…']
};
function setAuthMode(mode) {
  authMode=mode; const [heading,description,submit,switchText,switchButton]=AUTH_TEXT[mode];
  $('#authHeading').textContent=heading; $('#authDescription').textContent=description; $('#authSubmit').textContent=submit; $('#authSwitchText').textContent=switchText; $('#authSwitch').textContent=switchButton;
  const email=$('#authEmail'), password=$('#authPassword');
  // Disabled fields are skipped by the browser's "required" check, so hidden fields don't block the form.
  email.disabled=mode==='recovery'; email.closest('label').classList.toggle('hidden',mode==='recovery');
  password.disabled=mode==='forgot'; password.closest('label').classList.toggle('hidden',mode==='forgot');
  password.closest('label').firstChild.textContent=mode==='recovery'?'New password':'Password';
  password.autocomplete=mode==='signin'?'current-password':'new-password';
  $('#forgotLink').classList.toggle('hidden',mode!=='signin'); $('#authSwitch').parentElement.classList.toggle('hidden',mode==='recovery');
  $('#authMessage').textContent='';
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if(!requireSupabase()) return;
  const email=$('#authEmail').value.trim(), password=$('#authPassword').value;
  const button=$('#authSubmit'); button.disabled=true; button.textContent=AUTH_TEXT[authMode][5]; $('#authMessage').textContent='';
  try {
    if(authMode==='forgot') {
      const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});
      if(error) throw error;
      $('#authMessage').style.color='var(--green)'; $('#authMessage').textContent='If that email has a Settle account, a reset link is on its way. Check your inbox.'; return;
    }
    if(authMode==='recovery') {
      const {error}=await supabase.auth.updateUser({password});
      if(error) throw error;
      session=(await supabase.auth.getSession()).data.session; $('#authPassword').value=''; setAuthMode('signin');
      await enterApp(); showToast('Password updated. You are signed in.'); return;
    }
    const result=authMode==='signin' ? await supabase.auth.signInWithPassword({email,password}) : await supabase.auth.signUp({email,password});
    if(result.error) throw result.error;
    if(authMode==='signup' && !result.data.session) { $('#authMessage').style.color='var(--green)'; $('#authMessage').textContent='Account created. Check your email to confirm your address, then sign in.'; return; }
    session=result.data.session; await enterApp();
  } catch(error) { $('#authMessage').style.color='var(--red)'; $('#authMessage').textContent=error.message || 'Could not sign in. Please try again.'; }
  finally { button.disabled=false; button.textContent=AUTH_TEXT[authMode][2]; }
}

async function enterApp() {
  if(!session) return;
  $('#authScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden');
  $('#userEmail').textContent=session.user.email || 'Personal workspace'; $('#userAvatar').textContent=(session.user.email||'S').slice(0,1).toUpperCase();
  setSync('Syncing…');
  try { await loadData(); renderAll(); setSync('Synced'); }
  catch(error) { console.error(error); setSync('Sync error',true); showToast(error.message || 'Could not load your data.',true); }
}
async function signOut() { if(!supabase) return; const {error}=await supabase.auth.signOut(); if(error){showToast(error.message,true);return;} session=null;tasks=[];occurrences=[];$('#appShell').classList.add('hidden');$('#authScreen').classList.remove('hidden');$('#authPassword').value='';setAuthMode('signin'); }

async function loadData() {
  const [taskResult, occurrenceResult]=await Promise.all([
    supabase.from('tasks').select('*').order('created_at',{ascending:true}),
    supabase.from('task_occurrences').select('*').order('scheduled_date',{ascending:true})
  ]);
  if(taskResult.error) throw new Error(`Loading tasks failed: ${taskResult.error.message}`);
  if(occurrenceResult.error) throw new Error(`Loading task occurrences failed: ${occurrenceResult.error.message}`);
  tasks=taskResult.data||[]; occurrences=occurrenceResult.data||[];
  await ensureRecurringOccurrences();
}

async function ensureRecurringOccurrences() {
  const existingKeys=new Set(occurrences.filter(o=>o.scheduled_date).map(o=>`${o.task_id}|${o.scheduled_date}`));
  const toInsert=[];
  const today=localDateKey();
  const horizon=addDays(today,365);
  for(const task of tasks) {
    if(!isRecurring(task) || !task.start_date) continue;
    const lastDate=task.recurrence_until && task.recurrence_until < horizon ? task.recurrence_until : horizon;
    // Keep every past occurrence from the series start so missed tasks stay overdue and history remains complete.
    let date=task.start_date, safety=0;
    while(date<=lastDate && safety<5000) {
      const weekday=parseDate(date).getDay();
      if(task.recurrence_days.includes(weekday)) {
        const key=`${task.id}|${date}`;
        if(!existingKeys.has(key)) {
          toInsert.push({task_id:task.id,user_id:session.user.id,scheduled_date:date,start_time:task.default_start_time,end_time:task.default_end_time,status:'todo',completed_at:null});
          existingKeys.add(key);
        }
      }
      date=addDays(date,1); safety++;
    }
  }
  if(toInsert.length) {
    const {data,error}=await supabase.from('task_occurrences').upsert(toInsert,{onConflict:'task_id,scheduled_date',ignoreDuplicates:true}).select();
    if(error) throw new Error(`Creating recurring occurrences failed: ${error.message}`);
    if(data?.length) occurrences=[...occurrences,...data];
    // Fetch again because ignore-duplicate upsert may not return rows on all PostgREST versions.
    const {data:fresh,error:refreshError}=await supabase.from('task_occurrences').select('*').order('scheduled_date',{ascending:true});
    if(refreshError) throw refreshError;
    occurrences=fresh||[];
  }
}

function fillTimeSelects() {
  for(const selector of ['#taskStart','#taskEnd']) {
    const select=$(selector); select.innerHTML='';
    const blank=document.createElement('option'); blank.value=''; blank.textContent=selector==='#taskStart'?'No start time':'No end time'; select.append(blank);
    for(let minute=START_HOUR*60;minute<=END_HOUR*60;minute+=30) { const option=document.createElement('option'); option.value=minutesToTime(minute); option.textContent=displayTime(minutesToTime(minute)); select.append(option); }
  }
  $('#taskStart').addEventListener('change',()=>{ const start=timeToMinutes($('#taskStart').value); const end=timeToMinutes($('#taskEnd').value); if(start!==null&&(end===null||end<=start)) $('#taskEnd').value=minutesToTime(Math.min(END_HOUR*60,start+60)); });
}
function openComposer() { $('#taskComposer').classList.remove('hidden'); $('#taskTitle').focus(); }
function closeComposer() { $('#taskComposer').classList.add('hidden'); $('#taskForm').reset(); $('#repeatDaysField').classList.add('hidden'); }
function toggleRepeatFields() { $('#repeatDaysField').classList.toggle('hidden',$('#taskRepeat').value!=='weekly'); }

async function createTask(event) {
  event.preventDefault(); if(!session) return;
  const title=$('#taskTitle').value.trim(); if(!title) return;
  const firstDate=$('#taskDate').value||null;
  const startTime=$('#taskStart').value||null;
  let endTime=$('#taskEnd').value||null;
  if(startTime && (!endTime || timeToMinutes(endTime)<=timeToMinutes(startTime))) endTime=minutesToTime(Math.min(END_HOUR*60,timeToMinutes(startTime)+60));
  const repeating=$('#taskRepeat').value==='weekly';
  const weekdays=$$('#repeatDays input:checked').map(input=>Number(input.value));
  if(repeating && !firstDate) { showToast('Choose the first date for a recurring task.',true); return; }
  if(repeating && weekdays.length===0) { showToast('Choose at least one day for the recurring task.',true); return; }
  const until=$('#repeatUntil').value||null;
  if(repeating && until && until<firstDate) { showToast('The repeat-until date must be on or after the first date.',true); return; }
  const submit=$('#taskForm button[type="submit"]'); submit.disabled=true; submit.textContent='Saving…';
  try {
    const effectiveStart=firstDate?(startTime||minutesToTime(START_HOUR*60)):null;
    const effectiveEnd=firstDate?(endTime||(effectiveStart?minutesToTime(timeToMinutes(effectiveStart)+60):null)):null;
    const taskPayload={user_id:session.user.id,title,recurrence_days:repeating?weekdays:null,recurrence_until:repeating?until:null,start_date:firstDate,default_start_time:effectiveStart,default_end_time:effectiveEnd};
    const {data:task,error:taskError}=await supabase.from('tasks').insert(taskPayload).select().single();
    if(taskError) throw taskError;
    tasks.push(task);
    if(repeating) {
      await ensureRecurringOccurrences();
    } else {
      const status=$('#taskStatus').value;
      const {data:occ,error}=await supabase.from('task_occurrences').insert({task_id:task.id,user_id:session.user.id,scheduled_date:firstDate,start_time:effectiveStart,end_time:effectiveEnd,status,completed_at:status==='done'?new Date().toISOString():null}).select().single();
      if(error) throw error; occurrences.push(occ);
    }
    closeComposer(); if(firstDate) { const current=weekDates(weekOffset); if(firstDate<current[0]||firstDate>current[6]) { const monday=mondayOf(); const diff=(parseDate(firstDate)-monday)/(7*86400000); weekOffset=Math.round(diff); } }
    renderAll(); setSync('Synced'); showToast(repeating?'Recurring task created. Future occurrences are scheduled.':'Task saved.');
  } catch(error) { console.error(error); showToast(error.message||'Could not save task.',true); setSync('Save failed',true); }
  finally { submit.disabled=false; submit.textContent='Save task'; }
}

async function updateOccurrence(id, patch, successMessage='Changes saved.') {
  const old=occurrences.find(o=>o.id===id); if(!old) return;
  const payload={...patch};
  if(Object.prototype.hasOwnProperty.call(payload,'status')) payload.completed_at=payload.status==='done'?new Date().toISOString():null;
  if(Object.prototype.hasOwnProperty.call(payload,'status') && payload.status!=='done') payload.completed_at=null;
  const {data,error}=await supabase.from('task_occurrences').update(payload).eq('id',id).select().single();
  if(error) { console.error(error); showToast(error.message||'Could not update task.',true); setSync('Save failed',true); return; }
  occurrences=occurrences.map(o=>o.id===id?data:o); setSync('Synced'); renderAll(); if(successMessage) showToast(successMessage);
}
async function deleteOccurrence(id) {
  const occ=occurrences.find(o=>o.id===id); if(!occ) return;
  if(!confirm(`Delete this occurrence of “${titleFor(occ)}”? The recurring task's other dates will remain.`)) return;
  const {error}=await supabase.from('task_occurrences').delete().eq('id',id);
  if(error){showToast(error.message,true);return;} occurrences=occurrences.filter(o=>o.id!==id); renderAll(); showToast('Occurrence deleted.');
}

function setView(view) {
  activeView=view;
  $$('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  for(const name of ['calendar','board','history']) $(`#${name}View`).classList.toggle('hidden',name!==view);
  const titles={calendar:['YOUR WEEK','Calendar'],board:['YOUR TASKS','Task board'],history:['YOUR PROGRESS','Completion history']};
  $('#viewEyebrow').textContent=titles[view][0]; $('#viewTitle').textContent=titles[view][1]; renderAll();
}
function renderAll() { renderCalendar(); renderBoard(); renderHistory(); }
function makeDraggable(element,occ) {
  element.draggable=true; element.dataset.occurrenceId=occ.id;
  element.addEventListener('dragstart',event=>{dragOccurrenceId=occ.id;element.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',occ.id);});
  element.addEventListener('dragend',()=>{element.classList.remove('dragging');dragOccurrenceId=null;$$('.drag-over').forEach(el=>el.classList.remove('drag-over'));});
}
function makeDeleteButton(occ) { const button=document.createElement('button');button.className='event-delete';button.type='button';button.textContent='×';button.title='Delete this occurrence';button.addEventListener('click',event=>{event.stopPropagation();deleteOccurrence(occ.id);});return button; }
function renderCalendar() {
  const dates=weekDates(weekOffset); const grid=$('#calendarGrid'); grid.innerHTML=''; grid.style.gridTemplateRows=`34px repeat(${END_HOUR-START_HOUR}, ${ROW_HEIGHT}px)`;
  const corner=document.createElement('div');corner.className='calendar-corner';corner.style.gridRow='1';grid.append(corner);
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; const today=localDateKey();
  dates.forEach((date,index)=>{const d=parseDate(date);const head=document.createElement('div');head.className='day-header'+(date===today?' today':'');head.style.gridColumn=String(index+2);head.style.gridRow='1';head.innerHTML=`<div class="day-name">${dayNames[d.getDay()]}</div><div class="day-number">${d.getDate()}</div>`;grid.append(head);});
  for(let hour=START_HOUR;hour<END_HOUR;hour++){const label=document.createElement('div');label.className='hour-label';label.style.gridRow=String(hour-START_HOUR+2);label.textContent=displayTime(`${String(hour).padStart(2,'0')}:00`);grid.append(label);}
  dates.forEach((date,index)=>{
    const col=document.createElement('div');col.className='day-column'+(date===today?' today':'');col.dataset.date=date;col.style.gridColumn=String(index+2);col.style.gridRow=`2 / span ${END_HOUR-START_HOUR}`;
    for(let hour=1;hour<END_HOUR-START_HOUR;hour++){const line=document.createElement('div');line.className='hour-line';line.style.top=`${hour*ROW_HEIGHT}px`;col.append(line);}
    col.addEventListener('dragover',event=>{event.preventDefault();col.classList.add('drag-over');event.dataTransfer.dropEffect='move';});col.addEventListener('dragleave',()=>col.classList.remove('drag-over'));
    col.addEventListener('drop',async event=>{event.preventDefault();col.classList.remove('drag-over');const id=dragOccurrenceId||event.dataTransfer.getData('text/plain');if(!id)return;const rect=col.getBoundingClientRect();let minute=START_HOUR*60+((event.clientY-rect.top)/ROW_HEIGHT)*60;minute=Math.round(minute/30)*30;minute=Math.max(START_HOUR*60,Math.min((END_HOUR-.5)*60,minute));const occ=occurrences.find(o=>o.id===id);if(!occ)return;const duration=(timeToMinutes(occ.end_time)??(timeToMinutes(occ.start_time)??START_HOUR*60)+60)-(timeToMinutes(occ.start_time)??START_HOUR*60);const start=minutesToTime(minute);const end=minutesToTime(Math.min(END_HOUR*60,minute+Math.max(30,duration)));await updateOccurrence(id,{scheduled_date:date,start_time:start,end_time:end},'Task rescheduled.');});
    const dayOccurrences=occurrences.filter(o=>o.scheduled_date===date&&o.start_time).sort((a,b)=>timeToMinutes(a.start_time)-timeToMinutes(b.start_time));
    dayOccurrences.forEach(occ=>col.append(makeCalendarEvent(occ)));
    grid.append(col);
  });
  const start=dates[0],end=dates[6];$('#weekLabel').textContent=`${formatDate(start,{month:'short',day:'numeric'})} – ${formatDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  renderUnscheduled();
}
function makeCalendarEvent(occ) {
  const card=document.createElement('div');card.className='calendar-event'+(occ.status==='done'?' is-done':'');const [color,bg]=colorFor(occ);card.style.setProperty('--event-color',color);card.style.setProperty('--event-bg',bg);
  const start=timeToMinutes(occ.start_time)??START_HOUR*60,end=timeToMinutes(occ.end_time)??start+60;card.style.top=`${(start-START_HOUR*60)/60*ROW_HEIGHT}px`;card.style.height=`${Math.max(25,(end-start)/60*ROW_HEIGHT-2)}px`;
  const title=document.createElement('span');title.className='event-title';title.textContent=titleFor(occ);card.append(title);
  const time=document.createElement('span');time.className='event-time';time.textContent=`${displayTime(occ.start_time)} – ${displayTime(occ.end_time)}`;card.append(time);
  if(occ.status==='done'){const tag=document.createElement('span');tag.className='event-status';tag.textContent='✓ Done';card.append(tag);}else if(isRecurring(taskFor(occ))){const tag=document.createElement('span');tag.className='event-status';tag.textContent='↻ Recurring';card.append(tag);}
  card.append(makeDeleteButton(occ));makeDraggable(card,occ);attachResize(card,occ);return card;
}
function attachResize(card,occ) {
  const handle=document.createElement('div');handle.className='resize-handle';handle.title='Drag to change duration';handle.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();resizing={id:occ.id,startY:event.clientY,originalEnd:timeToMinutes(occ.end_time)??(timeToMinutes(occ.start_time)+60),col:card.parentElement};card.setPointerCapture?.(event.pointerId);});card.append(handle);
}
document.addEventListener('pointermove',event=>{if(!resizing)return;const rect=resizing.col.getBoundingClientRect();let end=START_HOUR*60+((event.clientY-rect.top)/ROW_HEIGHT)*60;end=Math.round(end/30)*30;end=Math.max((timeToMinutes(occurrences.find(o=>o.id===resizing.id)?.start_time)||START_HOUR*60)+30,Math.min(END_HOUR*60,end));const card=$(`.calendar-event[data-occurrence-id="${resizing.id}"]`);if(card){const start=timeToMinutes(occurrences.find(o=>o.id===resizing.id)?.start_time)||START_HOUR*60;card.style.height=`${Math.max(25,(end-start)/60*ROW_HEIGHT-2)}px`;const label=card.querySelector('.event-time');if(label)label.textContent=`${displayTime(minutesToTime(start))} – ${displayTime(minutesToTime(end))}`;}resizing.pendingEnd=minutesToTime(end);});
document.addEventListener('pointerup',async()=>{if(!resizing)return;const state=resizing;resizing=null;if(state.pendingEnd)await updateOccurrence(state.id,{end_time:state.pendingEnd},'Task duration updated.');});
function renderUnscheduled() {
  const wrap=$('#unscheduledCards');wrap.innerHTML='';const list=occurrences.filter(o=>!o.scheduled_date&&o.status!=='done');
  if(!list.length){const empty=document.createElement('span');empty.className='empty-inline';empty.textContent='No unscheduled tasks.';wrap.append(empty);}
  list.forEach(occ=>{const card=document.createElement('div');card.className='task-card';card.style.padding='8px 10px';card.style.minWidth='170px';card.style.maxWidth='250px';const [color,bg]=colorFor(occ);card.style.borderLeft=`3px solid ${color}`;const title=document.createElement('span');title.style.fontSize='12px';title.style.fontWeight='700';title.textContent=titleFor(occ);card.append(title);const del=makeDeleteButton(occ);del.style.opacity='1';card.style.position='relative';card.append(del);makeDraggable(card,occ);wrap.append(card);});
  const zone=$('#unscheduledZone');zone.ondragover=event=>{event.preventDefault();zone.classList.add('drag-over');};zone.ondragleave=()=>zone.classList.remove('drag-over');zone.ondrop=async event=>{event.preventDefault();zone.classList.remove('drag-over');const id=dragOccurrenceId||event.dataTransfer.getData('text/plain');if(id)await updateOccurrence(id,{scheduled_date:null,start_time:null,end_time:null},'Task moved to Unscheduled.');};
}

function isOverdue(occ) { return occ.status!=='done' && occ.scheduled_date && occ.scheduled_date<localDateKey(); }
function renderBoard() {
  const boardOccurrences=occurrences.filter(occ=>{
    if(occ.status==='done') return occ.completed_at && occ.completed_at>=new Date(Date.now()-30*86400000).toISOString();
    return !occ.scheduled_date || occ.scheduled_date<=addDays(localDateKey(),30);
  }).sort((a,b)=>{const ad=a.scheduled_date||'9999-99-99',bd=b.scheduled_date||'9999-99-99';return ad.localeCompare(bd)||titleFor(a).localeCompare(titleFor(b));});
  $$('.kanban-column').forEach(column=>{
    const status=column.dataset.status,wrap=$('.kanban-cards',column);wrap.innerHTML='';const items=boardOccurrences.filter(o=>o.status===status);$('.count',column).textContent=String(items.length);
    wrap.ondragover=event=>{event.preventDefault();wrap.classList.add('drag-over');};wrap.ondragleave=event=>{if(!wrap.contains(event.relatedTarget))wrap.classList.remove('drag-over');};wrap.ondrop=async event=>{event.preventDefault();wrap.classList.remove('drag-over');const id=dragOccurrenceId||event.dataTransfer.getData('text/plain');if(id)await updateOccurrence(id,{status},status==='done'?'Occurrence completed.':'Task status updated.');};
    if(!items.length){const empty=document.createElement('div');empty.className='empty-inline';empty.textContent=status==='todo'?'Nothing waiting here.':status==='in_progress'?'Nothing in progress.':'No recent completions.';wrap.append(empty);}
    items.forEach(occ=>wrap.append(makeTaskCard(occ)));
  });
}
function makeTaskCard(occ) {
  const card=document.createElement('article');card.className='task-card'+(isOverdue(occ)?' overdue':'');makeDraggable(card,occ);
  const title=document.createElement('h4');title.textContent=titleFor(occ);card.append(title);const del=makeDeleteButton(occ);del.style.opacity='1';del.style.top='7px';del.style.right='7px';card.append(del);
  const meta=document.createElement('div');meta.className='card-meta';const date=document.createElement('span');date.textContent=occ.scheduled_date?formatDate(occ.scheduled_date,{month:'short',day:'numeric'}):'Unscheduled';meta.append(date);
  if(occ.start_time){const time=document.createElement('span');time.textContent=`${displayTime(occ.start_time)}${occ.end_time?' – '+displayTime(occ.end_time):''}`;meta.append(time);}
  const task=taskFor(occ);if(isRecurring(task)){const repeat=document.createElement('span');repeat.textContent='↻ Recurring';meta.append(repeat);}if(isOverdue(occ)){const overdue=document.createElement('span');overdue.className='overdue-tag';overdue.textContent='Overdue';meta.append(overdue);}card.append(meta);
  const actions=document.createElement('div');actions.className='card-actions';const select=document.createElement('select');select.setAttribute('aria-label','Change task status');for(const [value,label] of [['todo','To Do'],['in_progress','In Progress'],['done','Done']]){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=occ.status===value;select.append(option);}select.addEventListener('click',event=>event.stopPropagation());select.addEventListener('change',()=>updateOccurrence(occ.id,{status:select.value},select.value==='done'?'Occurrence completed.':'Task status updated.'));actions.append(select);const hint=document.createElement('span');hint.className='tiny muted';hint.textContent=isRecurring(task)?'This occurrence only':'';actions.append(hint);card.append(actions);return card;
}
function renderHistory() {
  const wrap=$('#historyList');wrap.innerHTML='';const done=occurrences.filter(o=>o.status==='done').sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
  if(!done.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='No completed tasks yet. When you mark a task Done, its completion will appear here.';wrap.append(empty);return;}
  done.forEach(occ=>{const row=document.createElement('div');row.className='history-item';const left=document.createElement('div');const title=document.createElement('strong');title.textContent=titleFor(occ);const detail=document.createElement('p');const dateText=occ.scheduled_date?formatDate(occ.scheduled_date,{month:'long',day:'numeric',year:'numeric'}):'Unscheduled task';const completed=occ.completed_at?new Date(occ.completed_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Completion time unavailable';detail.textContent=`Scheduled: ${dateText} · Completed: ${completed}${isRecurring(taskFor(occ))?' · Recurring occurrence':''}`;left.append(title,detail);const check=document.createElement('span');check.className='history-check';check.textContent='✓';row.append(left,check);wrap.append(row);});
}

$('#authForm').addEventListener('submit',handleAuthSubmit);
$('#authSwitch').addEventListener('click',()=>setAuthMode(authMode==='signin'?'signup':'signin'));
$('#forgotLink').addEventListener('click',()=>setAuthMode('forgot'));
$('#signOutBtn').addEventListener('click',signOut);
$('#newTaskTop').addEventListener('click',openComposer);$('#closeComposer').addEventListener('click',closeComposer);$('#cancelTask').addEventListener('click',closeComposer);$('#taskForm').addEventListener('submit',createTask);$('#taskRepeat').addEventListener('change',toggleRepeatFields);
$$('.nav-item').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
$('#prevWeek').addEventListener('click',()=>{weekOffset--;renderCalendar();});$('#nextWeek').addEventListener('click',()=>{weekOffset++;renderCalendar();});$('#todayBtn').addEventListener('click',()=>{weekOffset=0;renderCalendar();});
fillTimeSelects();

if(!configured) { setAuthMode('signin'); $('#authMessage').textContent='Setup needed: configure config.js with your Supabase URL and publishable/anon key.'; $('#authMessage').style.color='var(--amber)'; setSync('Setup required',true); }
else {
  if(openedFromResetLink) setAuthMode('recovery');
  else if(urlHash.get('error_description')) $('#authMessage').textContent=`${urlHash.get('error_description')}. Please request a new link.`;
  supabase.auth.getSession().then(async({data,error})=>{if(error){showToast(error.message,true);return;}session=data.session;if(session&&authMode!=='recovery')await enterApp();});
  supabase.auth.onAuthStateChange((event,newSession)=>{
    session=newSession;
    if(event==='PASSWORD_RECOVERY'){$('#appShell').classList.add('hidden');$('#authScreen').classList.remove('hidden');setAuthMode('recovery');return;}
    if(newSession&&authMode!=='recovery'&&$('#appShell').classList.contains('hidden'))enterApp();
  });
}
