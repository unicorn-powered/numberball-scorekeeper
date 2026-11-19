'use strict';

// Room transport: no Firebase calls or external imports occur until a valid
// Firebase config is supplied and a visitor chooses Create / Join.
const session={mode:'none',code:null,uid:null,unsubscribe:null,unsubConnection:null,connected:false,dataReady:false};
const conf=window.NUMBERBALL_FIREBASE_CONFIG||{};
const configured=['apiKey','authDomain','databaseURL','projectId','appId'].every(k=>typeof conf[k]==='string'&&conf[k].trim().length>0);
let cloud=null, activeWrite=false;
const normalizeRoomCode=s=>String(s||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,8);
const validRoomCode=code=>/^[A-HJ-NP-Z2-9]{6}$/.test(code)||/^[A-HJ-NP-Z2-9]{8}$/.test(code);
const roomAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateId(){const a=new Uint32Array(3);crypto.getRandomValues(a);return Date.now().toString(36)+'-'+Array.from(a,v=>v.toString(36)).join('');}
function generateRoomCode(){const bytes=new Uint32Array(6);crypto.getRandomValues(bytes);return Array.from(bytes,x=>roomAlphabet[x%roomAlphabet.length]).join('');}
function normalise(raw){const v=raw||{}, players=Array.isArray(v.players)?v.players:Object.values(v.players||{}),events=Array.isArray(v.events)?v.events:Object.values(v.events||{}),rates=v.rates||{};
 return {players:players.length>=2&&players.length<=4?players:defaults().players,rates:{bonus:Number(rates.bonus??1),game:Number(rates.game??2),foul:Number(rates.foul??1)},events,revision:Number(v.revision||0),rateBackup:v.rateBackup||null,selected:state.selected};}
function roomPayload(draft){return {players:draft.players,rates:draft.rates,events:draft.events,revision:draft.revision,...(draft.rateBackup?{rateBackup:draft.rateBackup}:{})};}
function setBusy(busy,text=''){
 ['createBtn','joinBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=busy});
 if(text){const err=$('createError');if(!$('createSessionDialog').open){$('joinError').textContent=text;$('joinError').hidden=false}else{err.textContent=text;err.hidden=false}}
}
function showWelcome(){showSessions()}
function startRoom(mode,code,initialState){
 session.mode=mode;session.code=code;session.connected=false;session.dataReady=false;
 state=normalise(initialState);
 state.selected=localStorage.getItem('sg_nb_selection_'+code)||state.players[0].id;
 $('sessionsScreen').hidden=true;$('appShell').hidden=false;window.scrollTo(0,0);
 $('roomCode').textContent=code;$('shareBtn').hidden=false;setConnectionStatus('connecting');
 localStorage.setItem(LAST_ROOM_KEY,code);rememberRoom(code,state,true);
 const url=new URL(location.href);url.searchParams.set('room',code);
 if(location.protocol==='https:'||location.protocol==='http:')history.replaceState(null,'',url.pathname+url.search+url.hash);
 render();
}
function populateNewNames(){
 const count=Number($('newPlayerCount').value);
 const prior=Array.from($('newNameFields').querySelectorAll('input')).map(n=>n.value);
 $('newNameFields').innerHTML=Array.from({length:count},(_,i)=>`<div><label class="field" for="newName_${i}">Player ${i+1} name</label><input id="newName_${i}" name="newName_${i}" maxlength="28" autocomplete="off" placeholder="Enter player name" value="${escapeHtml(prior[i]||'')}" required></div>`).join('');
}
function openCreateDialog(){
 $('newPlayerCount').value='4';$('newNameFields').innerHTML='';populateNewNames();
 $('newBonusRate').value='1';$('newGameRate').value='2';$('newFoulRate').value='1';
 $('createError').hidden=true;$('createSessionDialog').showModal();
}
function openJoinDialog(code=''){
 $('joinCode').value=normalizeRoomCode(code);$('joinError').hidden=true;$('joinSessionDialog').showModal();
}
function setupLanding(){
 $('sessionNewBtn').onclick=openCreateDialog;
 $('sessionJoinBtn').onclick=()=>openJoinDialog();
 $('leaveBtn').onclick=showSessions;
 $('sessionSearch').oninput=renderSavedRooms;
 $('newPlayerCount').onchange=()=>{populateNewNames();$('createError').hidden=true};
 $('createForm').addEventListener('input',()=>{$('createError').hidden=true});
 $('sessionsList').onclick=async e=>{
  const forget=e.target.closest('[data-forget-room]');
  if(forget){forgetSavedRoom(forget.dataset.forgetRoom);renderSavedRooms();return;}
  const b=e.target.closest('[data-open-room]');if(b)await openSavedRoom(b.dataset.openRoom);
 };
 $('createForm').onsubmit=async e=>{
  e.preventDefault();$('createError').hidden=true;
  const count=Number($('newPlayerCount').value);
  const names=Array.from({length:count},(_,i)=>$('newName_'+i).value.trim());
  const rates={bonus:Number($('newBonusRate').value),game:Number($('newGameRate').value),foul:Number($('newFoulRate').value)};
  const rawRates=['newBonusRate','newGameRate','newFoulRate'].map(id=>$(id).value.trim());
  let error='';
  if(!validInt(count,2,4))error='Choose 2, 3 or 4 players.';
  else if(names.some(n=>!n))error='Enter a name for every player.';
  else if(new Set(names.map(n=>n.toLowerCase())).size!==count)error='Player names must be different.';
  else if(rawRates.some(s=>s==='')||Object.values(rates).some(n=>!validInt(n)))error='Enter valid whole-number rates for Bonus, Game and Foul.';
  if(error){$('createError').textContent=error;$('createError').hidden=false;return}
  const draft=defaults(count);draft.players=draft.players.map((p,i)=>({...p,name:names[i]}));draft.rates=rates;
  try{setBusy(true);await createLiveRoom(draft);$('createSessionDialog').close();notify('Room created');}
  catch(err){$('createError').textContent=firebaseError(err);$('createError').hidden=false;console.warn(err)}
  finally{setBusy(false)}
 };
 $('joinCode').addEventListener('input',e=>{const v=normalizeRoomCode(e.target.value);if(e.target.value!==v)e.target.value=v});
 $('joinForm').onsubmit=async e=>{e.preventDefault();await joinFromInput($('joinCode').value)};
 $('roomCode').onclick=()=>copyText(session.code||'','Room code copied');
 $('shareBtn').onclick=async()=>{if(session.mode!=='live')return;
  const url=new URL(location.href);url.searchParams.set('room',session.code);
  try{if(navigator.share){await navigator.share({title:'Number Ball',text:'Join room '+session.code,url:url.href});return}}catch(e){if(e.name==='AbortError')return}
  await copyText(url.href,'Room link copied');
 };
 if(!configured){$('welcomeSetup').hidden=false;$('welcomeSetup').textContent='Firebase is not configured. Add your Firebase web settings before creating or joining a room.'}
 const linked=normalizeRoomCode(new URLSearchParams(location.search).get('room'));
 showSessions();
 if(validRoomCode(linked))openJoinDialog(linked);
}
async function copyText(text,message){if(!text){notify(message);return}try{await navigator.clipboard.writeText(text);notify(message)}catch(e){const inp=document.createElement('textarea');inp.value=text;inp.style.position='fixed';inp.style.top='-9999px';document.body.append(inp);inp.select();const worked=document.execCommand('copy');inp.remove();notify(worked?message:'Copy unavailable. Code: '+text)}}
function firebaseError(e){const msg=String(e?.message||e||'');if(!configured)return 'Firebase not configured. Edit firebase-config.js to enable live rooms.';if(/auth\/operation-not-allowed/i.test(msg))return 'Enable Anonymous in Firebase Authentication → Sign-in methods.';if(/permission.denied|PERMISSION_DENIED/i.test(msg))return 'Permission denied. Check database.rules.json was published in Firebase.';if(/network|offline|failed.to.fetch/i.test(msg))return 'Connection failed. Check your network and database URL.';return msg.slice(0,250)}
async function ensureFirebase(){if(!configured)throw Error('Firebase not configured. Add Firebase keys to firebase-config.js first.');
 if(!cloud){const ver='13.3.0';const [app,auth,database]=await Promise.all([
 import('https://www.gstatic.com/firebasejs/'+ver+'/firebase-app.js'),
 import('https://www.gstatic.com/firebasejs/'+ver+'/firebase-auth.js'),
 import('https://www.gstatic.com/firebasejs/'+ver+'/firebase-database.js')]);
 const fbApp=app.initializeApp(conf);cloud={authAPI:auth,dbAPI:database,auth:auth.getAuth(fbApp),db:database.getDatabase(fbApp)};}
 await cloud.auth.authStateReady();if(!cloud.auth.currentUser)await cloud.authAPI.signInAnonymously(cloud.auth);
 session.uid=cloud.auth.currentUser.uid;return cloud;
}
async function createLiveRoom(data){if(!Array.isArray(data.players)||data.players.length<2||data.players.length>4)throw Error('Choose 2–4 players');const fb=await ensureFirebase();
 for(let tries=0;tries<5;tries++){const code=generateRoomCode(),ref=fb.dbAPI.ref(fb.db,'rooms/'+code);
 try{await fb.dbAPI.set(ref,{createdBy:session.uid,createdAt:Date.now(),data:roomPayload(data)});await joinLiveRoom(code,data);return;}catch(e){if(/permission.denied/i.test(String(e?.message||e))&&tries<4)continue;throw e;}}
 throw Error('Could not generate a unique room. Try again.');}
async function joinFromInput(raw){
 const code=normalizeRoomCode(raw);
 if(!validRoomCode(code)){$('joinError').textContent='Enter a valid six-character code (or older eight-character code).';$('joinError').hidden=false;if(!$('joinSessionDialog').open)openJoinDialog(raw);return;}
 try{setBusy(true);const fb=await ensureFirebase();const snap=await fb.dbAPI.get(fb.dbAPI.ref(fb.db,'rooms/'+code+'/data'));
  if(!snap.exists())throw Error('Room not found. Check the code.');
  await joinLiveRoom(code,snap.val());if($('joinSessionDialog').open)$('joinSessionDialog').close();
 }catch(e){if(!$('joinSessionDialog').open)openJoinDialog(code);$('joinError').textContent=firebaseError(e);$('joinError').hidden=false;notify('Could not join room');console.warn(e)}
 finally{setBusy(false)}
}
async function joinLiveRoom(code,initial){const fb=await ensureFirebase();if(session.unsubscribe){session.unsubscribe();session.unsubscribe=null}if(session.unsubConnection){session.unsubConnection();session.unsubConnection=null}
 startRoom('live',code,initial);
 session.unsubscribe=fb.dbAPI.onValue(fb.dbAPI.ref(fb.db,'rooms/'+code+'/data'),snap=>{
 if(session.mode!=='live'||session.code!==code)return;
 if(!snap.exists()){session.dataReady=false;setConnectionStatus('missing');return;}
 session.dataReady=true;setConnectionStatus();rememberRoom(code,snap.val(),false);
 const selection=state.selected;state=normalise(snap.val());state.selected=state.players.some(p=>p.id===selection)?selection:state.players[0].id;render();
 },err=>{session.dataReady=false;setConnectionStatus('error');notify('Sync error: '+firebaseError(err))});
 session.unsubConnection=fb.dbAPI.onValue(fb.dbAPI.ref(fb.db,'.info/connected'),snap=>{
 if(session.mode!=='live'||session.code!==code)return;session.connected=!!snap.val();setConnectionStatus();
 });}
async function commit(mutator){if(session.mode!=='live'||activeWrite)return false;activeWrite=true;
 try{
  const fb=await ensureFirebase();const path=fb.dbAPI.ref(fb.db,'rooms/'+session.code+'/data');let rejected=false;
 const result=await fb.dbAPI.runTransaction(path,raw=>{
 if(!raw)return;
 const draft=normalise(raw);if(mutator(draft)===false){rejected=true;return;}
 draft.revision=(Number(raw.revision)||0)+1;return roomPayload(draft);
 },{applyLocally:false});
 if(!result.committed){notify(rejected?'Session changed. Refresh and try again.':'Nothing to update');return false;}return true;
 }catch(e){notify('Not saved: '+firebaseError(e));console.error(e);return false;}
 finally{activeWrite=false;}
}


/* Private room library: only codes already used in this browser are indexed.
 * Existing Firebase room data and rules remain unchanged. */
function setConnectionStatus(override=''){
 const el=$('connectionStatus');if(!el)return;
 el.classList.remove('is-live','is-warning');
 if(override==='connecting'){el.textContent='○ Connecting…';return;}
 if(override==='missing'){el.textContent='○ Room unavailable';el.classList.add('is-warning');return;}
 if(override==='error'){el.textContent='○ Sync error';el.classList.add('is-warning');return;}
 if(session.mode!=='live'||!session.connected){el.textContent='○ Reconnecting…';el.classList.add('is-warning');return;}
 if(!session.dataReady){el.textContent='○ Connecting…';return;}
 el.textContent='● Live · Synced';el.classList.add('is-live');
}
function savedRooms(){
 let arr=[];try{const parsed=JSON.parse(localStorage.getItem(SAVED_ROOMS_KEY)||'[]');if(Array.isArray(parsed))arr=parsed;}catch(e){}
 arr=arr.filter(item=>item&&validRoomCode(item.code)).map(item=>({code:item.code,opened:Number(item.opened)||0,players:Array.isArray(item.players)?item.players.slice(0,4).map(String):[],games:Number(item.games)||0,unavailable:!!item.unavailable}));
 const legacy=normalizeRoomCode(localStorage.getItem(LAST_ROOM_KEY));if(validRoomCode(legacy)&&!arr.some(item=>item.code===legacy))arr.push({code:legacy,opened:0,players:[],games:0});
 return Array.from(new Map(arr.map(item=>[item.code,item])).values()).sort((a,b)=>b.opened-a.opened);
}
function persistSavedRooms(rooms){try{localStorage.setItem(SAVED_ROOMS_KEY,JSON.stringify(rooms.slice(0,100)))}catch(e){console.warn('Could not save room history',e)}}
function rememberRoom(code,roomState,touch){
 if(!validRoomCode(code))return;
 const rooms=savedRooms(),prior=rooms.find(r=>r.code===code)||{code,opened:0,players:[],games:0};
 const entry={...prior,opened:touch?Date.now():prior.opened,unavailable:false};
 if(roomState&&typeof roomState==='object'){
   const players=Array.isArray(roomState.players)?roomState.players:Object.values(roomState.players||{});
   if(players.length>=2&&players.length<=4)entry.players=players.map(p=>String(p.name||'Player')).slice(0,4);
   const events=Array.isArray(roomState.events)?roomState.events:Object.values(roomState.events||{});
   entry.games=events.filter(e=>e?.kind==='game').length;
 }
 persistSavedRooms([entry,...rooms.filter(r=>r.code!==code)].sort((a,b)=>b.opened-a.opened));
}
function forgetSavedRoom(code){
 const rooms=savedRooms().filter(r=>r.code!==code);persistSavedRooms(rooms);
 if(localStorage.getItem(LAST_ROOM_KEY)===code){if(rooms.length)localStorage.setItem(LAST_ROOM_KEY,rooms[0].code);else localStorage.removeItem(LAST_ROOM_KEY)}
}
function renderSavedRooms(){
 const all=savedRooms(),q=$('sessionSearch').value.trim().toLowerCase();
 const rooms=all.filter(r=>!q||(r.code.toLowerCase().includes(q)||r.players.some(name=>name.toLowerCase().includes(q))));
 $('sessionListStatus').textContent=`${all.length} saved room${all.length===1?'':'s'} on this device`;
 $('sessionsList').innerHTML=rooms.length?rooms.map(r=>{
  const names=r.players.length?r.players.join(' · '):'Open to load player names';
  const last=r.opened?new Date(r.opened).toLocaleString('en-SG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Previously visited';
  return `<div class="savedRoom"><button type="button" class="savedRoomInfo" data-open-room="${escapeHtml(r.code)}" aria-label="Open room ${escapeHtml(r.code)}"><span class="savedRoomTop"><strong class="savedRoomCode">${escapeHtml(r.code)}</strong>${r.code===session.code?'<span class="savedRoomBadge">CURRENT</span>':''}</span><span class="savedRoomPeople">${escapeHtml(names)}</span><span class="savedRoomMeta">${r.games} completed game${r.games===1?'':'s'} · ${escapeHtml(last)}</span></button><button type="button" class="savedRoomForget" data-forget-room="${escapeHtml(r.code)}" aria-label="Remove room ${escapeHtml(r.code)} from this device">Forget</button></div>`;
 }).join(''):`<div class="empty">${q?'No matching sessions.':'No saved sessions yet. Create one or join with a room code.'}</div>`;
}
function showSessions(){
 $('appShell').hidden=true;$('sessionsScreen').hidden=false;window.scrollTo(0,0);
 $('sessionSearch').value='';renderSavedRooms();refreshSavedRoomDetails();
 const url=new URL(location.href);url.searchParams.delete('room');
 if(location.protocol==='https:'||location.protocol==='http:')history.replaceState(null,'',url.pathname+url.search+url.hash);
}
async function openSavedRoom(code){
 if(session.mode==='live'&&session.code===code){$('sessionsScreen').hidden=true;$('appShell').hidden=false;window.scrollTo(0,0);return}
 await joinFromInput(code);
}
async function refreshSavedRoomDetails(){
 const rooms=savedRooms();if(!rooms.length||!configured)return;
 try{
  const fb=await ensureFirebase();
  await Promise.all(rooms.map(async room=>{
   try{const snap=await fb.dbAPI.get(fb.dbAPI.ref(fb.db,'rooms/'+room.code+'/data'));
    if(snap.exists())rememberRoom(room.code,snap.val(),false);
   }catch(e){console.debug('Room metadata unavailable',room.code,e)}
  }));
  if(!$('sessionsScreen').hidden)renderSavedRooms();
 }catch(e){console.warn('Could not refresh session list',e)}
}

const LAST_ROOM_KEY='sg_numberball_v05_recent_room';
const SAVED_ROOMS_KEY='sg_numberball_v071_saved_rooms';
const $=id=>document.getElementById(id);
const defaultNames=['Player 1','Player 2','Player 3','Player 4'];
const defaults=(count=4)=>({players:defaultNames.slice(0,count).map((name,i)=>({id:'p'+(i+1),name})),rates:{bonus:1,game:2,foul:1},selected:'p1',events:[],revision:0});
let state=defaults();
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>(n<0?'−':'')+Math.abs(n).toLocaleString('en-SG',{maximumFractionDigits:0});
const signed=n=>(n>0?'+':'')+fmt(n);
const cash=n=>(n<0?'−':'')+'$'+Math.abs(n).toLocaleString('en-SG',{maximumFractionDigits:0});
const name=id=>state.players.find(p=>p.id===id)?.name||'Unknown';
const gameNo=()=>1+state.events.filter(e=>e.kind==='game').length;
const validInt=(n,min=0,max=10000)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const zero=()=>Object.fromEntries(state.players.map(p=>[p.id,0]));
const save=()=>{if(session.mode==='live'&&session.code){try{localStorage.setItem('sg_nb_selection_'+session.code,state.selected)}catch(e){console.warn(e)}}};
function notify(msg){let el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(notify.timeout);notify.timeout=setTimeout(()=>el.classList.remove('show'),2300)}
// Rate-based ledger. Legacy events with incomplete evidence retain their original value.
function valuedEvent(e,rates=state.rates,players=state.players){
 const ids=players.map(p=>p.id),old=e.deltas||{};
 if(e.kind==='foul'){
  const qty=Number(e.quantity);
  if(Number.isSafeInteger(qty)&&qty>=0)return {amount:qty*rates.foul,poolDelta:qty*rates.foul,recalculated:true,deltas:{}};
  return {amount:Number(e.poolDelta??e.amount??0),poolDelta:Number(e.poolDelta??e.amount??0),recalculated:false,deltas:{}};
 }
 if(e.kind==='bonus'||e.kind==='game'){
  const payers=Array.isArray(e.payers)?e.payers:[];
  const opponents=ids.filter(id=>id!==e.actor);
  const valid=ids.includes(e.actor)&&payers.length>0&&new Set(payers).size===payers.length&&payers.every(id=>opponents.includes(id));
  // All = exactly every opponent, Bao = exactly one opponent.
  const isAll=valid&&payers.length===opponents.length;
  const isBao=valid&&payers.length===1;
  if((isAll||isBao)&&Number.isFinite(Number(e.rate))){
   const rate=rates[e.kind],total=rate*opponents.length,deltas=Object.fromEntries(ids.map(id=>[id,0]));
   deltas[e.actor]=total;
   if(isAll)opponents.forEach(id=>deltas[id]-=rate);
   else deltas[payers[0]]-=total;
   return {amount:total,poolDelta:0,recalculated:true,deltas};
  }
 }
 return {amount:Number(e.total??e.amount??0),poolDelta:Number(e.poolDelta||0),recalculated:false,deltas:old};
}
function totals(){
 const balances=zero(),gameBalances=zero(),foulBalances=zero(),fouls=zero(),bonuses=zero(),games=zero();let pool=0;
 for(const e of state.events){
   const value=valuedEvent(e);
   if(e.kind!=='foul')for(const [id,delta] of Object.entries(value.deltas)){
     if(Object.hasOwn(gameBalances,id)){balances[id]+=Number(delta)||0;gameBalances[id]+=Number(delta)||0;}
   }
   if(e.kind==='foul'&&Object.hasOwn(fouls,e.actor)){
     fouls[e.actor]+=Number(e.quantity)||0;
     foulBalances[e.actor]-=value.poolDelta;
   }
   pool+=value.poolDelta;
   if(e.kind==='bonus'&&Object.hasOwn(bonuses,e.actor))bonuses[e.actor]++;
   if(e.kind==='game'&&Object.hasOwn(games,e.actor))games[e.actor]++;
 }
 return {balances,gameBalances,foulBalances,fouls,bonuses,games,pool};
}
function netTransfers(balances){
 const debt=state.players.map(p=>({id:p.id,amount:Math.max(0,-balances[p.id])})).filter(x=>x.amount>0);
 const credit=state.players.map(p=>({id:p.id,amount:Math.max(0,balances[p.id])})).filter(x=>x.amount>0);
 const lines=[];let i=0,j=0;
 while(i<debt.length&&j<credit.length){const amount=Math.min(debt[i].amount,credit[j].amount);if(amount>0)lines.push({from:debt[i].id,to:credit[j].id,amount});debt[i].amount-=amount;credit[j].amount-=amount;if(!debt[i].amount)i++;if(!credit[j].amount)j++;}
 return lines;
}
async function record(event){event.time=new Date().toISOString();event.id=generateId();event.writer=session.uid||'offline';return commit(draft=>{if(!draft.players.some(p=>p.id===event.actor)||Object.keys(event.deltas||{}).length!==draft.players.length||!Object.keys(event.deltas||{}).every(id=>draft.players.some(p=>p.id===id)))return false;if(['bonus','game','foul'].includes(event.kind)&&draft.rates[event.kind]!==event.rate)return false;const item={...event,calculationVersion:2,gameNo:1+draft.events.filter(e=>e.kind==='game').length};draft.events.push(item);});}
function render(){
 if(!state.players.some(p=>p.id===state.selected))state.selected=state.players[0].id;
 $('scoreBonusRate').textContent=fmt(state.rates.bonus);$('scoreGameRate').textContent=fmt(state.rates.game);$('scoreFoulRate').textContent=fmt(state.rates.foul);
 const t=totals();$('gameNo').textContent=String(gameNo()).padStart(2,'0');$('poolStat').textContent=fmt(t.pool);$('undoBtn').disabled=!state.events.length;$('selectedBadge').textContent=name(state.selected);
 $('players').innerHTML=state.players.map(p=>`<button type="button" class="player ${p.id===state.selected?'active':''}" data-player="${escapeHtml(p.id)}" aria-pressed="${p.id===state.selected}"><div class="phead"><span class="avatar">${escapeHtml(p.name[0]?.toUpperCase()||'P')}</span><span class="indicator">${p.id===state.selected?'● ACTIVE':'TAP TO SELECT'}</span></div><div class="pname">${escapeHtml(p.name)}</div><div class="pscores"><span class="pvalue ${t.gameBalances[p.id]>0?'plus':t.gameBalances[p.id]<0?'minus':''}">${signed(t.gameBalances[p.id])}</span><span class="pfoul" title="Separate foul-pool contribution">(${signed(t.foulBalances[p.id])})</span></div><div class="pfoot"><span>★ ${t.games[p.id]} games</span><span>! ${t.fouls[p.id]} fouls</span></div></button>`).join('');
 $('players').querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{state.selected=b.dataset.player;save();render()});
 
 const events=state.events.slice().reverse().slice(0,12);
 $('history').innerHTML=events.length?events.map(e=>{
   let kind=e.kind==='bonus'?'Bonus':e.kind==='game'?'Game win':e.kind==='foul'?'Foul ×'+e.quantity:'Adjustment';
   let desc=e.kind==='foul'?'Added to pool':e.kind==='manual'?`From ${escapeHtml(name(e.payers?.[0]))}`:e.payers?.length===state.players.length-1?'All players':`Bao · ${escapeHtml(name(e.payers?.[0]))}`;
   let amount=valuedEvent(e).amount;
   return `<div class="entry"><div><b>${escapeHtml(name(e.actor))} · ${kind}</b><small>Game ${e.gameNo} · ${new Date(e.time).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit'})} · ${desc}</small></div><span class="value">${e.kind==='foul'?'−':'+'}${fmt(amount)}</span></div>`;
 }).join(''):'<div class="empty">No results recorded yet.</div>';
}
let actionKind='bonus',mode='all',baoPlayer=null;
const opponents=()=>state.players.filter(p=>p.id!==state.selected);
const fixedTotal=()=>state.rates[actionKind]*(state.players.length-1);
function payerAllocation(){if(mode==='all')return Object.fromEntries(opponents().map(p=>[p.id,state.rates[actionKind]]));return baoPlayer?{[baoPlayer]:fixedTotal()}:{};}
function setMode(value){mode=value;if(value==='all')baoPlayer=null;$('allMode').classList.toggle('active',value==='all');$('baoMode').classList.toggle('active',value==='bao');$('allMode').setAttribute('aria-pressed',String(value==='all'));$('baoMode').setAttribute('aria-pressed',String(value==='bao'));updateTransfer();}
function openTransfer(kind){actionKind=kind;baoPlayer=null;$('transferTitle').textContent=kind==='bonus'?'Record bonus':'Record game win';$('transferExplain').textContent='Choose All or Bao. Bao is always one player only.';$('receiverLabel').textContent=name(state.selected);$('totalMath').textContent=`${fmt(state.rates[kind])} × ${state.players.length-1} others`;$('transferTotal').textContent='+'+fmt(fixedTotal());setMode('all');$('transferDialog').showModal();}
function updateTransfer(){const amounts=payerAllocation(),chosen=Object.keys(amounts);
 $('payerTiles').innerHTML=opponents().map(p=>{let yes=Object.hasOwn(amounts,p.id);return `<button class="payertile ${yes?'active':''}" type="button" data-payer="${escapeHtml(p.id)}" aria-pressed="${yes}"><b>${escapeHtml(p.name)}</b><span class="tilevalue">${yes?'−'+fmt(amounts[p.id]):'—'}</span><span class="tilenote">${yes?'✓ SELECTED':'TAP TO CHOOSE'}</span></button>`}).join('');
 $('payerTiles').querySelectorAll('[data-payer]').forEach(b=>b.onclick=()=>{if(mode==='all'){mode='bao';baoPlayer=b.dataset.payer;setMode('bao');}else{baoPlayer=b.dataset.payer;updateTransfer();}});
 $('transferPreview').textContent=mode==='all'?`Each of the ${opponents().length} other players gets −${fmt(state.rates[actionKind])}.`:(baoPlayer?`${name(baoPlayer)} covers the entire ${fmt(fixedTotal())}.`:'Choose one player for Bao.');
 $('transferBreakdown').innerHTML=chosen.map(id=>`<div class="previewline"><span class="small">${escapeHtml(name(id))}</span><b>−${fmt(amounts[id])}</b></div>`).join('');
 $('transferSubmit').disabled=!chosen.length;$('transferSubmit').textContent=actionKind==='bonus'?'Record bonus':'Record game win';
}
$('allMode').onclick=()=>setMode('all');$('baoMode').onclick=()=>setMode('bao');$('bonusBtn').onclick=()=>openTransfer('bonus');$('gameBtn').onclick=()=>openTransfer('game');
$('transferForm').onsubmit=async e=>{e.preventDefault();const amounts=payerAllocation(),ids=Object.keys(amounts),total=fixedTotal();if(!ids.length){notify('Choose one Bao player');return}const d=zero(),actor=state.selected;d[actor]+=total;ids.forEach(id=>d[id]-=amounts[id]);if(await record({kind:actionKind,actor,total,rate:state.rates[actionKind],payers:ids,payerAmounts:amounts,deltas:d,poolDelta:0,gameNo:gameNo()})){$('transferDialog').close();notify(actionKind==='bonus'?'Bonus recorded':'Game win recorded');}};
$('foulBtn').onclick=()=>{$('foulExplain').textContent=name(state.selected)+' selected';$('foulQty').value='1';updateFoulPreview();$('foulDialog').showModal()};
function updateFoulPreview(){const qty=Math.max(1,Number($('foulQty').value)||1);$('foulPreview').textContent=`${qty} foul${qty===1?'':'s'} · Pool +${fmt(qty*state.rates.foul)}`;}
$('foulQty').oninput=updateFoulPreview;
$('foulForm').onsubmit=async e=>{e.preventDefault();const quantity=Number($('foulQty').value);if(!validInt(quantity,1,50)){notify('Choose 1–50 fouls');return}const amount=quantity*state.rates.foul,d=zero(),actor=state.selected;if(await record({kind:'foul',actor,quantity,rate:state.rates.foul,amount,payers:[],deltas:d,poolDelta:amount,gameNo:gameNo()})){$('foulDialog').close();notify('Foul recorded')}};
$('undoBtn').onclick=async()=>{if(!state.events.length)return;if(await commit(draft=>{if(!draft.events.length)return false;draft.events.pop();}))notify('Last result undone')};
$('adjustBtn').onclick=()=>{$('manualFrom').innerHTML=$('manualTo').innerHTML=state.players.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');$('manualTo').value=state.selected;$('manualFrom').value=opponents()[0].id;$('manualAmount').value='5';$('manualReason').value='';$('manualDialog').showModal()};
$('manualForm').onsubmit=async e=>{e.preventDefault();const actor=$('manualTo').value,from=$('manualFrom').value,amount=Number($('manualAmount').value);if(from===actor){notify('Choose different players');return}if(!validInt(amount,1,10000)){notify('Whole numbers only');return}const d=zero();d[actor]+=amount;d[from]-=amount;if(await record({kind:'manual',actor,payers:[from],amount,deltas:d,poolDelta:0,gameNo:gameNo(),reason:$('manualReason').value.trim()})){$('manualDialog').close();notify('Adjustment recorded')}};
function buildNames(count){$('nameFields').innerHTML=Array.from({length:count},(_,i)=>`<label class="field" for="player_${i}">Player ${i+1}</label><input id="player_${i}" maxlength="28" required value="${escapeHtml(state.players[i]?.name||defaultNames[i])}">`).join('')}
$('settingsBtn').onclick=()=>{$('playerCount').value=state.players.length;$('bonusRate').value=state.rates.bonus;$('gameRate').value=state.rates.game;$('foulRate').value=state.rates.foul;buildNames(state.players.length);$('settingsDialog').showModal()};$('playerCount').onchange=()=>buildNames(Number($('playerCount').value));
function confirmAction(title,body,callback){$('confirmTitle').textContent=title;$('confirmText').textContent=body;$('confirmDialog').showModal();$('confirmYes').onclick=()=>{$('confirmDialog').close();callback()};}
$('settingsForm').onsubmit=async e=>{e.preventDefault();const count=Number($('playerCount').value),rates={bonus:Number($('bonusRate').value),game:Number($('gameRate').value),foul:Number($('foulRate').value)};if(Object.values(rates).some(v=>!validInt(v))){notify('Use whole-number rates');return}const names=Array.from({length:count},(_,i)=>$('player_'+i).value.trim());if(names.some(x=>!x)||new Set(names.map(x=>x.toLowerCase())).size!==count){notify('Enter distinct player names');return}
 const apply=async()=>{if(await commit(draft=>{const old=draft.players;draft.players=names.map((name,i)=>({id:old[i]?.id||'p'+(i+1),name}));if(Object.keys(rates).some(k=>rates[k]!==draft.rates[k])&&draft.events.length&&!draft.rateBackup){draft.rateBackup={rates:{...draft.rates},events:JSON.parse(JSON.stringify(draft.events)),savedAt:new Date().toISOString()};}draft.rates=rates;if(count!==old.length)draft.events=[];})){$('settingsDialog').close();notify('Session updated')}};
 if(count!==state.players.length&&state.events.length)confirmAction('Change players?',`Changing the count clears all previous results, fouls and pool totals.`,apply);
 else if(state.events.length&&Object.keys(rates).some(k=>rates[k]!==state.rates[k])){
  const changed=Object.keys(rates).filter(k=>rates[k]!==state.rates[k]).map(k=>`${k}: $${state.rates[k]} → $${rates[k]}`).join(' · ');
  const affected=state.events.filter(e=>['bonus','game','foul'].includes(e.kind)&&rates[e.kind]!==state.rates[e.kind]);
  const legacy=affected.filter(e=>!valuedEvent(e).recalculated).length;
  confirmAction('Recalculate entire session?',`${changed}. Revalue ${affected.length-legacy} past scoring events, including earlier games. ${legacy?legacy+' legacy event(s) lack details and will retain their original value. ':''}Manual adjustments remain fixed.`,apply);
 }else apply();};
$('resetBtn').onclick=()=>confirmAction('Reset session?',`Erase all ${state.events.length} results, scores and foul counts?`,async()=>{if(await commit(draft=>{draft.events=[]}))notify('Session reset')});
for(const btn of document.querySelectorAll('[data-step-target]'))btn.onclick=()=>{const el=$(btn.dataset.stepTarget),min=Number(el.min||0),max=Number(el.max||10000);let v=Number(el.value);if(!Number.isFinite(v))v=min;el.value=String(Math.max(min,Math.min(max,Math.round(v)+Number(btn.dataset.step))));el.dispatchEvent(new Event('input',{bubbles:true}))};
function settlementSummary(){const t=totals(),transfers=netTransfers(t.gameBalances);return ['NUMBER BALL — SETTLEMENT',`Completed games: ${gameNo()-1}`,`Bonus: ${cash(state.rates.bonus)} | Game: ${cash(state.rates.game)} | Foul: ${cash(state.rates.foul)}`,'', 'WHO PAYS WHOM',...(transfers.length?transfers.map(x=>`${name(x.from)} pays ${name(x.to)} ${cash(x.amount)}`):['No player transfers']),'','FOUL POOL — TABLE FEES',...state.players.map(p=>`${p.name}: ${t.fouls[p.id]} foul(s), ${cash(-t.foulBalances[p.id])}`),`Total: ${cash(t.pool)}`].join('\n')}
function showSettlement(){const t=totals(),transfers=netTransfers(t.gameBalances);
 $('settleMovement').textContent=cash(transfers.reduce((s,x)=>s+x.amount,0));$('settlePool').textContent=cash(t.pool);
 $('settleLines').innerHTML=transfers.length?transfers.map(x=>`<div class="settlerow"><div><b>${escapeHtml(name(x.from))}</b><span class="arrow">→</span><b>${escapeHtml(name(x.to))}</b><small>${escapeHtml(name(x.from))} pays ${escapeHtml(name(x.to))}</small></div><strong>${cash(x.amount)}</strong></div>`).join(''):'<div class="empty">All player balances are settled.</div>';
 $('settleFouls').innerHTML=state.players.map(p=>`<div class="settlerow"><div><b>${escapeHtml(p.name)}</b><small>${t.fouls[p.id]} foul${t.fouls[p.id]===1?'':'s'}</small></div><strong>${cash(-t.foulBalances[p.id])}</strong></div>`).join('')+`<div class="settlerow"><b>Total reserved for venue</b><strong>${cash(t.pool)}</strong></div>`;
 $('settlementDialog').showModal();
}
$('settlementBtn').onclick=showSettlement;
$('copyBtn').onclick=async()=>{try{await navigator.clipboard.writeText(settlementSummary());notify('Settlement copied')}catch(e){notify('Clipboard unavailable; use CSV export')}};
const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
$('exportBtn').onclick=()=>{const t=totals(),transfers=netTransfers(t.gameBalances),rows=[['NUMBER BALL — PRIVATE SESSION EXPORT'],['TYPE','GAME','TIME','PLAYER','OTHER PLAYERS','VALUE SGD','FOUL COUNT','POOL DELTA SGD','NOTE'],...state.events.map(e=>[e.kind,e.gameNo,e.time,name(e.actor),e.kind==='bonus'||e.kind==='game'?Object.entries(valuedEvent(e).deltas).filter(([id,v])=>v<0).map(([id,v])=>`${name(id)}: ${-v}`).join('; '):(e.payers||[]).map(name).join('; '),valuedEvent(e).amount,e.quantity||0,valuedEvent(e).poolDelta,e.reason||'']),[],['PLAYER','GAME + BONUS NET SGD','TABLE FEE CONTRIBUTION SGD','GAMES','BONUSES','FOULS'],...state.players.map(p=>[p.name,t.balances[p.id],-t.foulBalances[p.id],t.games[p.id],t.bonuses[p.id],t.fouls[p.id]]),[],['FOUL POOL SGD',t.pool],[],['PAYS','RECEIVES','AMOUNT SGD'],...transfers.map(x=>[name(x.from),name(x.to),x.amount])];let blob=new Blob(['\ufeff'+rows.map(row=>row.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='number-ball-session-v090-private.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notify('Private CSV exported')};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
setupLanding();