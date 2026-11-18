'use strict';

// Room transport: no Firebase calls or external imports occur until a valid
// Firebase config is supplied and a visitor chooses Create / Join.
const session={mode:'none',code:null,uid:null,unsubscribe:null,unsubConnection:null,connected:false};
const conf=window.NUMBERBALL_FIREBASE_CONFIG||{};
const configured=['apiKey','authDomain','databaseURL','projectId','appId'].every(k=>typeof conf[k]==='string'&&conf[k].trim().length>0);
let cloud=null, activeWrite=false;
const normalizeRoomCode=s=>String(s||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,8);
const validRoomCode=code=>/^[A-HJ-NP-Z2-9]{6}$/.test(code)||/^[A-HJ-NP-Z2-9]{8}$/.test(code);
const roomAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateId(){const a=new Uint32Array(3);crypto.getRandomValues(a);return Date.now().toString(36)+'-'+Array.from(a,v=>v.toString(36)).join('');}
function generateRoomCode(){const bytes=new Uint32Array(6);crypto.getRandomValues(bytes);return Array.from(bytes,x=>roomAlphabet[x%roomAlphabet.length]).join('');}
function normalise(raw){const v=raw||{}, players=Array.isArray(v.players)?v.players:Object.values(v.players||{}),events=Array.isArray(v.events)?v.events:Object.values(v.events||{}),rates=v.rates||{};
 return {players:players.length>=2&&players.length<=4?players:defaults().players,rates:{bonus:Number(rates.bonus??5),game:Number(rates.game??10),foul:Number(rates.foul??1)},events,revision:Number(v.revision||0),selected:state.selected};}
function roomPayload(draft){return {players:draft.players,rates:draft.rates,events:draft.events,revision:draft.revision};}
function setBusy(busy,text=''){['createBtn','joinBtn','recentBtn'].forEach(id=>$(id).disabled=busy);$('welcomeBusy').textContent=text;}
function showWelcome(){if(session.unsubscribe){session.unsubscribe();session.unsubscribe=null}if(session.unsubConnection){session.unsubConnection();session.unsubConnection=null}session.mode='none';session.code=null;session.connected=false;
 $('appShell').hidden=true;$('welcomeScreen').hidden=false;window.scrollTo(0,0);$('joinCode').value=normalizeRoomCode(new URLSearchParams(location.search).get('room')||localStorage.getItem(LAST_ROOM_KEY)||'');
 const cleaned=new URL(location.href);cleaned.searchParams.delete('room');if(location.protocol==='https:'||location.protocol==='http:')history.replaceState(null,'',cleaned.pathname+cleaned.search+cleaned.hash);
 const recent=localStorage.getItem(LAST_ROOM_KEY);$('recentBtn').hidden=!recent;if(recent)$('recentBtn').textContent='Continue '+recent;
 setBusy(false);}
function startRoom(mode,code,initialState){session.mode=mode;session.code=code;session.connected=(mode==='demo');state=normalise(initialState);state.selected=(mode==='live'?localStorage.getItem('sg_nb_selection_'+code):initialState?.selected)||state.players[0].id;
 $('welcomeScreen').hidden=true;$('appShell').hidden=false;window.scrollTo(0,0);
 $('roomCode').textContent=code||'DEMO';$('shareBtn').hidden=mode!=='live';$('footerStatus').textContent=mode==='live'?'LIVE ROOM · Shared scoreboard':'OFFLINE DEMO · This device only';
 $('connectionStatus').textContent=mode==='live'?'Connecting…':'Stored on this device only';
 if(mode==='live'){localStorage.setItem(LAST_ROOM_KEY,code);const url=new URL(location.href);url.searchParams.set('room',code);(location.protocol==='https:'||location.protocol==='http:')&&history.replaceState(null,'',url.pathname+url.search+url.hash)}
 render();}
function setupLanding(){
 const urlRoom=normalizeRoomCode(new URLSearchParams(location.search).get('room'));
 const last=normalizeRoomCode(localStorage.getItem(LAST_ROOM_KEY));
 $('joinCode').value=urlRoom||last;
 $('recentBtn').hidden=!last;if(last)$('recentBtn').textContent='Continue '+last;
 if(!configured){$('welcomeSetup').hidden=false;$('welcomeSetup').textContent='Live session setup needed: add your Firebase web configuration to firebase-config.js and deploy the site. You can still test the offline demo below.';}
 $('joinCode').addEventListener('input',e=>{const v=normalizeRoomCode(e.target.value);if(e.target.value!==v)e.target.value=v;});
 $('createForm').onsubmit=async e=>{e.preventDefault();try{setBusy(true,'Creating room…');await createLiveRoom(Number($('newPlayerCount').value));}catch(err){notify('Could not create room');$('welcomeBusy').textContent=firebaseError(err);console.warn(err)}finally{setBusy(false)}};
 $('joinForm').onsubmit=async e=>{e.preventDefault();await joinFromInput($('joinCode').value)};
 $('recentBtn').onclick=()=>joinFromInput(localStorage.getItem(LAST_ROOM_KEY));
 $('demoBtn').onclick=()=>{let stored=null;try{stored=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}if(!stored||!Array.isArray(stored.players))stored=defaults(Number($('newPlayerCount').value));startRoom('demo',null,stored)};
 $('leaveBtn').onclick=showWelcome;
 $('roomCode').onclick=()=>copyText(session.code||'',session.code?'Room code copied':'This is a demo room');
 $('shareBtn').onclick=async()=>{if(session.mode!=='live')return;const url=new URL(location.href);url.searchParams.set('room',session.code);const text=`Join Number Ball room ${session.code}`;
 try{if(navigator.share){await navigator.share({title:'Number Ball',text,url:url.href});return}}catch(e){if(e.name==='AbortError')return}
 await copyText(url.href,'Room link copied');};
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
async function createLiveRoom(count){if(count<2||count>4)throw Error('Choose 2–4 players');const fb=await ensureFirebase();
 for(let tries=0;tries<5;tries++){const code=generateRoomCode(),ref=fb.dbAPI.ref(fb.db,'rooms/'+code),data=defaults(count);
 try{await fb.dbAPI.set(ref,{createdBy:session.uid,createdAt:Date.now(),data:roomPayload(data)});await joinLiveRoom(code,data);return;}catch(e){if(/permission.denied/i.test(String(e?.message||e))&&tries<4)continue;throw e;}}
 throw Error('Could not generate a unique room. Try again.');}
async function joinFromInput(raw){const code=normalizeRoomCode(raw);if(!validRoomCode(code)){notify('Enter a 6-character code (or an older 8-character code)');return;}
 try{setBusy(true,'Joining '+code+'…');const fb=await ensureFirebase();const snap=await fb.dbAPI.get(fb.dbAPI.ref(fb.db,'rooms/'+code+'/data'));if(!snap.exists())throw Error('Room not found. Check the code.');await joinLiveRoom(code,snap.val());}
 catch(e){$('welcomeBusy').textContent=firebaseError(e);notify('Could not join room');console.warn(e)}finally{setBusy(false)}}
async function joinLiveRoom(code,initial){const fb=await ensureFirebase();if(session.unsubscribe){session.unsubscribe();session.unsubscribe=null}if(session.unsubConnection){session.unsubConnection();session.unsubConnection=null}
 startRoom('live',code,initial);
 session.unsubscribe=fb.dbAPI.onValue(fb.dbAPI.ref(fb.db,'rooms/'+code+'/data'),snap=>{
 if(session.mode!=='live'||session.code!==code)return;
 if(!snap.exists()){$('connectionStatus').textContent='Room no longer available';return;}
 const selection=state.selected;state=normalise(snap.val());state.selected=state.players.some(p=>p.id===selection)?selection:state.players[0].id;render();
 },err=>{$('connectionStatus').textContent='Sync error';notify('Sync error: '+firebaseError(err))});
 session.unsubConnection=fb.dbAPI.onValue(fb.dbAPI.ref(fb.db,'.info/connected'),snap=>{
 if(session.mode!=='live'||session.code!==code)return;session.connected=!!snap.val();$('connectionStatus').textContent=session.connected?'● Live · Synced':'○ Reconnecting…';
 });}
async function commit(mutator){if(!['demo','live'].includes(session.mode)||activeWrite)return false;activeWrite=true;
 try{
 if(session.mode==='demo'){const draft=normalise(state);draft.selected=state.selected;if(mutator(draft)===false)return false;draft.revision++;state=draft;save();render();return true;}
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

const KEY='sg_numberball_v05_demo';
const LAST_ROOM_KEY='sg_numberball_v05_recent_room';
const $=id=>document.getElementById(id);
const defaultNames=['Player 1','Player 2','Player 3','Player 4'];
const defaults=(count=4)=>({players:defaultNames.slice(0,count).map((name,i)=>({id:'p'+(i+1),name})),rates:{bonus:5,game:10,foul:1},selected:'p1',events:[],revision:0});
let state=defaults();
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>(n<0?'−':'')+Math.abs(n).toLocaleString('en-SG',{maximumFractionDigits:0});
const signed=n=>(n>0?'+':'')+fmt(n);
const cash=n=>(n<0?'−':'')+'$'+Math.abs(n).toLocaleString('en-SG',{maximumFractionDigits:0});
const name=id=>state.players.find(p=>p.id===id)?.name||'Unknown';
const gameNo=()=>1+state.events.filter(e=>e.kind==='game').length;
const validInt=(n,min=0,max=10000)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const zero=()=>Object.fromEntries(state.players.map(p=>[p.id,0]));
const save=()=>{if(session.mode==='demo'){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){console.warn(e)}}else if(session.mode==='live'&&session.code){try{localStorage.setItem('sg_nb_selection_'+session.code,state.selected)}catch(e){console.warn(e)}}};
function notify(msg){let el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(notify.timeout);notify.timeout=setTimeout(()=>el.classList.remove('show'),2300)}
function totals(){
 // Two independent ledgers: player scores (bonus/game/adjustments) and
 // table-fee contributions (fouls). Never deduct fouls from player scores.
 // Historical rooms may contain foul events with negative deltas from v0.5/v0.6;
 // ignore those deltas so old sessions also display the corrected scores.
 const balances=zero(),gameBalances=zero(),foulBalances=zero(),fouls=zero(),bonuses=zero(),games=zero();let pool=0;
 for(const e of state.events){
   if(e.kind!=='foul'){
     for(const [id,delta] of Object.entries(e.deltas||{})){
       if(Object.hasOwn(balances,id)){balances[id]+=delta;gameBalances[id]+=delta;}
     }
   }
   if(e.kind==='foul'&&Object.hasOwn(fouls,e.actor)){
     fouls[e.actor]+=(e.quantity||0);
     foulBalances[e.actor]-=Number(e.poolDelta??e.amount??((e.quantity||0)*(e.rate||0)));
   }
   pool+=Number(e.poolDelta||0);
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
async function record(event){event.time=new Date().toISOString();event.id=generateId();event.writer=session.uid||'offline';return commit(draft=>{if(!draft.players.some(p=>p.id===event.actor)||Object.keys(event.deltas||{}).length!==draft.players.length||!Object.keys(event.deltas||{}).every(id=>draft.players.some(p=>p.id===id)))return false;if(['bonus','game','foul'].includes(event.kind)&&draft.rates[event.kind]!==event.rate)return false;const item={...event,gameNo:1+draft.events.filter(e=>e.kind==='game').length};draft.events.push(item);});}
function render(){
 if(!state.players.some(p=>p.id===state.selected))state.selected=state.players[0].id;
 const t=totals();$('gameNo').textContent=String(gameNo()).padStart(2,'0');$('bonusRateStat').textContent=fmt(state.rates.bonus);$('gameRateStat').textContent=fmt(state.rates.game);$('poolStat').textContent=fmt(t.pool);$('undoBtn').disabled=!state.events.length;$('selectedBadge').textContent=name(state.selected);
 $('players').innerHTML=state.players.map(p=>`<button type="button" class="player ${p.id===state.selected?'active':''}" data-player="${escapeHtml(p.id)}" aria-pressed="${p.id===state.selected}"><div class="phead"><span class="avatar">${escapeHtml(p.name[0]?.toUpperCase()||'P')}</span><span class="indicator">${p.id===state.selected?'● ACTIVE':'TAP TO SELECT'}</span></div><div class="pname">${escapeHtml(p.name)}</div><div class="pscores"><span class="pvalue ${t.gameBalances[p.id]>0?'plus':t.gameBalances[p.id]<0?'minus':''}">${signed(t.gameBalances[p.id])}</span><span class="pfoul" title="Separate foul-pool contribution">(${signed(t.foulBalances[p.id])})</span></div><div class="pfoot"><span>★ ${t.games[p.id]} games</span><span>! ${t.fouls[p.id]} fouls</span></div></button>`).join('');
 $('players').querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{state.selected=b.dataset.player;save();render()});
 
 const events=state.events.slice().reverse().slice(0,12);
 $('history').innerHTML=events.length?events.map(e=>{
   let kind=e.kind==='bonus'?'Bonus':e.kind==='game'?'Game win':e.kind==='foul'?'Foul ×'+e.quantity:'Adjustment';
   let desc=e.kind==='foul'?'Added to pool':e.kind==='manual'?`From ${escapeHtml(name(e.payers?.[0]))}`:e.payers?.length===state.players.length-1?'All players':`Bao · ${escapeHtml(name(e.payers?.[0]))}`;
   let amount=e.kind==='foul'?e.amount:e.kind==='manual'?e.amount:e.total;
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
 const apply=async()=>{if(await commit(draft=>{const old=draft.players;draft.players=names.map((name,i)=>({id:old[i]?.id||'p'+(i+1),name}));draft.rates=rates;if(count!==old.length)draft.events=[];})){$('settingsDialog').close();notify('Session updated')}};
 if(count!==state.players.length&&state.events.length)confirmAction('Change players?',`Changing the count clears all previous results, fouls and pool totals.`,apply);else apply();};
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
$('exportBtn').onclick=()=>{const t=totals(),transfers=netTransfers(t.gameBalances),rows=[['NUMBER BALL — PRIVATE SESSION EXPORT'],['TYPE','GAME','TIME','PLAYER','OTHER PLAYERS','VALUE SGD','FOUL COUNT','POOL DELTA SGD','NOTE'],...state.events.map(e=>[e.kind,e.gameNo,e.time,name(e.actor),e.kind==='bonus'||e.kind==='game'?Object.entries(e.payerAmounts||{}).map(([id,v])=>`${name(id)}: ${v}`).join('; '):(e.payers||[]).map(name).join('; '),e.total??e.amount,e.quantity||0,e.poolDelta||0,e.reason||'']),[],['PLAYER','GAME + BONUS NET SGD','TABLE FEE CONTRIBUTION SGD','GAMES','BONUSES','FOULS'],...state.players.map(p=>[p.name,t.balances[p.id],-t.foulBalances[p.id],t.games[p.id],t.bonuses[p.id],t.fouls[p.id]]),[],['FOUL POOL SGD',t.pool],[],['PAYS','RECEIVES','AMOUNT SGD'],...transfers.map(x=>[name(x.from),name(x.to),x.amount])];let blob=new Blob(['\ufeff'+rows.map(row=>row.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='number-ball-session-v062-private.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notify('Private CSV exported')};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
setupLanding();