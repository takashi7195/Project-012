import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrediction, compareBoats, SCORE_CONFIG } from './scoring.mjs';
import { buildNarrativeInput } from './narrative.mjs';
import { predictionKeys, deadlineState } from './input-contract.mjs';
import { pollPrediction, displayResult, PredictionRequestError } from './client.mjs';
const fixture = () => ({race_id:'test',race_date:'2026-09-23',stadium_code:1,race_number:1,
 entries:Array.from({length:6},(_,i)=>({entry_number:i+1,name:'選手'+i,average_st:.14,rank_code:'A1',national_win_rate:6,local_win_rate:6,motor_top2_percent:40+i,motor_top3_percent:60+i,hull_top2_percent:40+i,hull_top3_percent:60+i})),
 preview_entries:Array.from({length:6},(_,i)=>({entry_number:i+1,course:i+1,time:6.7+i*.01,start_timing:.1+i*.01}))});
test('canonical keys ignore ingestion metadata and object property order', async()=>{
 const a=fixture(), b=structuredClone(a); b.last_success_at='later'; b.batch_id='new'; b.result_entries=[{actual_course:6}]; b.entries[0].updated_at='later';
 assert.deepEqual(await predictionKeys(a,SCORE_CONFIG.version,'logic'),await predictionKeys(b,SCORE_CONFIG.version,'logic'));
 b.entries[0]=Object.fromEntries(Object.entries(b.entries[0]).reverse());
 assert.deepEqual(await predictionKeys(a,SCORE_CONFIG.version,'logic'),await predictionKeys(b,SCORE_CONFIG.version,'logic'));
});
test('scoring input changes and score version changes invalidate reuse', async()=>{
 const a=fixture(), old=await predictionKeys(a,'v0.1.14-score-2','logic'), current=await predictionKeys(a,SCORE_CONFIG.version,'logic');
 assert.notEqual(old.reuseKey,current.reuseKey);
 for(const [section,field,value] of [['entries','average_st',.18],['entries','rank_code','B2'],['entries','national_win_rate',8],['entries','local_win_rate',8],['entries','motor_top2_percent',20],['entries','motor_top3_percent',90],['entries','hull_top2_percent',20],['entries','hull_top3_percent',90],['preview_entries','time',6.1],['preview_entries','course',6],['preview_entries','start_timing',.2]]) {
 const b=structuredClone(a); b[section][0][field]=value; const changed=await predictionKeys(b,SCORE_CONFIG.version,'logic'); assert.notEqual(current.inputDataHash,changed.inputDataHash,field); assert.notEqual(current.reuseKey,changed.reuseKey,field);
 }
});
for(const value of [-.01,'-0.01','F.01','L.01',null]) test('invalid exhibition ST excluded everywhere: '+value,()=>{
 const r=fixture();r.preview_entries[0].start_timing=value;const p=calculatePrediction(r), input=buildNarrativeInput(r,p);
 assert(p.components.excluded.some(x=>x.name==='exhibitionSt'));
 assert(p.boats.every(b=>!Object.hasOwn(b.componentScores,'exhibitionSt')));
 assert(input.boats.every(b=>b.exhibitionST===null));
 assert(input.boats.every(b=>b.keyFactors.every(f=>!f.id.includes('exhibition-st'))));
 const r2=structuredClone(r);r2.preview_entries[0].start_timing=null;assert.deepEqual(p.hole,calculatePrediction(r2).hole);
});
test('zero ST remains valid and snapshot stays immutable through narrative input',()=>{
 const r=fixture();r.preview_entries[0].start_timing=0;const p=calculatePrediction(r), before=JSON.stringify(p); const input=buildNarrativeInput(r,p);
 assert(p.components.included.some(x=>x.name==='exhibitionSt'));assert.equal(input.boats.find(b=>b.boat===1).exhibitionST,0);assert.equal(JSON.stringify(p),before);
});
test('excluded exhibition time not forwarded as raw narrative fact',()=>{
 const r=fixture();r.preview_entries[0].time=null; const p=calculatePrediction(r);assert(buildNarrativeInput(r,p).boats.every(b=>b.exhibitionTime===null));
});
test('equal-score tie uses actual time field only when adopted',()=>{
 const a={entryNumber:1,totalScore:50,time:6.9}, b={entryNumber:2,totalScore:50,time:6.7};
 assert(compareBoats(a,b,{exhibitionTime:true})>0); assert(compareBoats(a,b,{exhibitionTime:false})<0);
 assert.deepEqual([a,b].sort((a,b)=>compareBoats(a,b,{exhibitionTime:true})).map(b=>b.entryNumber),[2,1]);
});
for(const value of [null,undefined,'bad','2026-02-30T12:00:00Z','2026-09-23','2026-09-23T12:00:00']) test('invalid deadline blocks '+value,()=>assert.equal(deadlineState(value),'invalid'));
test('deadline before/at/after boundary',()=>{
 const value='2026-09-23T12:00:00+09:00', time=Date.parse(value);assert.equal(deadlineState(value,time-1),'open');assert.equal(deadlineState(value,time),'closed');assert.equal(deadlineState(value,time+1),'closed');
});
const success={status:200,body:{main:[1,2,3],counter:[2,1,4],hole:null,narrative:null}};
test('202 never reads picks; waits retryAfter and renders only final 200',async()=>{
 let calls=0, notifications=0, delay=0;const generating={status:'generating',retryAfter:3,get main(){throw Error('must not read picks')}};
 const result=await pollPrediction(async()=>++calls===1?{status:202,body:generating}:success,{onGenerating:()=>notifications++,sleep:async ms=>{delay=ms}});
 assert.deepEqual(result.main,[1,2,3]);assert.equal(calls,2);assert.equal(delay,3000);assert.equal(notifications,1);
});
test('polling is bounded and no non-200 response renders',async()=>{
 let calls=0;await assert.rejects(pollPrediction(async()=>{calls++;return {status:202,body:{status:'generating'}}},{maxRequests:2,sleep:async()=>{}}));assert.equal(calls,2);
 await assert.rejects(pollPrediction(async()=>({...success,status:201})));
});
test('timeout and cancellation reject even an unresponsive transport',async()=>{
 await assert.rejects(pollPrediction(()=>new Promise(()=>{}),{timeoutMs:10}));
 const c=new AbortController();c.abort();await assert.rejects(pollPrediction(async()=>success,{signal:c.signal}));
});
test('null hole and narrative never preserve previous result',()=>{
 const old=displayResult({main:[1,2,3],hole:[4,1,2],narrativeStatus:'success',narrative:'old'}); const next=displayResult(success.body);
 assert.equal(next.hole,null);assert.notEqual(next.narrative,old.narrative);assert.equal(next.narrative,'レース展開を生成できませんでした');
});
test('diagnostic average uses available boats while individual denominator excludes missing',()=>{
 const r=fixture();r.entries[0].rank_code=null;const p=calculatePrediction(r), c=p.components.included.find(x=>x.name==='class');assert.equal(c.earned,5);assert.equal(c.maximum,5);
 assert.equal(p.boats.find(b=>b.entryNumber===1).effectiveMaximum,61);assert.equal(p.boats.find(b=>b.entryNumber===2).effectiveMaximum,66);
});

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
function uiHarness(request) {
 const scheduled=new Map();let nextTimer=0;
 const setTimer=(fn,ms)=>{const id=++nextTimer;if(ms===60000)scheduled.set(id,fn);else queueMicrotask(()=>{if(scheduled.has(id)||ms!==60000)fn()});return id};
 const element=()=>({textContent:'old',style:{},childNodes:[],disabled:false,events:{},dataset:{},className:'slot',classList:{add(){},remove(){}},
 addEventListener(name,fn){this.events[name]=fn},replaceChildren(...children){this.childNodes=children;this.textContent=''},appendChild(child){this.childNodes.push(child)},removeAttribute(){},querySelector(){return this.reel}});
 const ids=Object.fromEntries(['start-btn','stadium-select','race-select','race-development-text','prediction-status','slot-1','slot-2','slot-3'].map(id=>[id,element()]));
 ids['start-btn'].textContent='START';
 ids['stadium-select'].options=[{value:'',disabled:false,dataset:{},setAttribute(){}}, {value:'桐生',disabled:false,dataset:{stadiumCode:'1',stadiumName:'桐生'},setAttribute(){}}];ids['stadium-select'].selectedIndex=0;ids['stadium-select'].value='';
 ids['race-select'].options=[{value:'',disabled:false,dataset:{},setAttribute(){}}, ...Array.from({length:12},(_,i)=>({value:`${i+1}R`,disabled:false,dataset:{},setAttribute(){}}))];ids['race-select'].selectedIndex=0;ids['race-select'].value='';
 for(const id of ['slot-1','slot-2','slot-3']) ids[id].reel=element();
 const rows={counter:element(),longshot:element()};
 const stops=[];
 const context=vm.createContext({AbortController,Intl,Date,Math,console,performance:{now:()=>0},setTimeout:setTimer,clearTimeout:id=>scheduled.delete(id),__request:request,__stops:stops,
  document:{getElementById:id=>ids[id],addEventListener(){},createElement:element,createDocumentFragment:element,querySelector:selector=>rows[selector.includes('counter')?'counter':'longshot']}});
 vm.runInContext(readFileSync(new URL('../script.js',import.meta.url),'utf8'),context);
 vm.runInContext('requestPrediction = __request; stopRoulette = async (slot, boat, delay) => { __stops.push({boat, delay}); };',context);
 context.applyStadiumAvailability([{stadiumCode:1,races:[{raceNumber:1,closedAt:'2099-12-31T00:00:00Z'},{raceNumber:2,closedAt:'2099-12-31T00:00:00Z'}]}]);
 vm.runInContext('stadiumAvailabilityReady = true',context);
 ids['stadium-select'].selectedIndex=1;ids['stadium-select'].value='桐生';ids['stadium-select'].events.change();
 ids['race-select'].selectedIndex=1;ids['race-select'].value='1R';ids['race-select'].events.change();
 return {ids,rows,context,stops,fireDeadline:()=>{for(const callback of scheduled.values())callback()},click:ids['start-btn'].events.click};
}
test('UI clears prior picks before awaiting; failure restores controls',async()=>{
 let reject;const ui=uiHarness(()=>new Promise((_,r)=>{reject=r}));const pending=ui.click();
 assert.equal(ui.rows.longshot.textContent,'—');assert.equal(ui.rows.counter.textContent,'—');assert.equal(ui.ids['start-btn'].disabled,true);
 assert.equal(ui.ids['prediction-status'].textContent,'レース解析中…');
 reject(Error('private transport detail'));await pending;assert.equal(ui.ids['start-btn'].disabled,false);assert.equal(ui.ids['stadium-select'].disabled,false);assert.equal(ui.ids['race-select'].disabled,false);assert.equal(ui.ids['prediction-status'].textContent,'解析できませんでした');
});
test('UI renders null hole/narrative without old content and clears on race switch',async()=>{
 const ui=uiHarness(async()=>displayResult(success.body));await ui.click();assert.equal(ui.rows.longshot.textContent,'—');assert.notEqual(ui.ids['race-development-text'].textContent,'old');assert.equal(ui.ids['start-btn'].disabled,false);
 assert.equal(ui.ids['race-development-text'].textContent,'レース展開を生成できませんでした');
 ui.ids['race-select'].selectedIndex=2;ui.ids['race-select'].value='2R';ui.ids['race-select'].events.change();assert.equal(ui.ids['race-development-text'].textContent,'');assert.equal(ui.rows.counter.textContent,'—');
});
test('race selection immediately enables START without waiting for interval refresh',()=>{
 const ui=uiHarness(()=>new Promise(()=>{}));assert.equal(ui.ids['start-btn'].disabled,false);
});
test('API and first three seconds overlap; companion picks render only after all reels stop plus 500ms',async()=>{
 const ui=uiHarness(async()=>({main:[1,2,3],counter:[2,1,4],hole:[4,2,1],narrative:'three paragraphs'}));
 await ui.click();
 assert.equal(JSON.stringify(ui.stops),JSON.stringify([{boat:3,delay:0},{boat:2,delay:6000},{boat:1,delay:9000}]));
 const rowText=row=>row.childNodes.map(node=>node.textContent).join('');
 assert.equal(rowText(ui.rows.counter),'2-1-4');assert.equal(rowText(ui.rows.longshot),'4-2-1');
 assert.equal(ui.ids['race-development-text'].textContent,'three paragraphs');assert.equal(ui.ids['prediction-status'].textContent,'');
 assert.equal(ui.ids['start-btn'].textContent,'START');
});
test('roulette starts while API is pending and secondary results stay hidden',async()=>{
 let resolveRequest;
 const ui=uiHarness(()=>new Promise(resolve=>{resolveRequest=resolve}));
 const pending=ui.click();
 await Promise.resolve();await Promise.resolve();
 assert.equal(ui.ids['prediction-status'].textContent,'レース解析中…');
 assert.equal(ui.ids['stadium-select'].disabled,true);assert.equal(ui.ids['race-select'].disabled,true);assert.equal(ui.ids['start-btn'].disabled,true);
 assert.equal(ui.rows.counter.textContent,'—');assert.equal(ui.rows.longshot.textContent,'—');assert.equal(ui.stops.length,0);
 resolveRequest({main:[1,2,3],counter:[2,1,4],hole:[4,2,1],narrative:'result'});
 await pending;assert.equal(ui.stops.length,3);
});
test('periodic availability update cannot unlock controls during the reveal run',async()=>{
 let rejectRequest;
 const ui=uiHarness((_signal)=>new Promise((_,reject)=>{rejectRequest=reject}));
 const pending=ui.click();
 ui.context.applyStadiumAvailability([{stadiumCode:1,races:[{raceNumber:1,closedAt:'2099-12-31T00:00:00Z'}]}]);
 ui.context.updateStartAvailability();
 assert.equal(ui.ids['stadium-select'].disabled,true);assert.equal(ui.ids['race-select'].disabled,true);assert.equal(ui.ids['start-btn'].disabled,true);
 rejectRequest(new Error('network'));await pending;
});
test('60-second acquisition timeout stops idle and allows manual retry for an open race',async()=>{
 let rejectRequest;
 const ui=uiHarness(signal=>new Promise((_,reject)=>{rejectRequest=reject;signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})}));
 const pending=ui.click();await Promise.resolve();
 ui.fireDeadline();await pending;
 assert.equal(ui.ids['prediction-status'].textContent,'解析できませんでした');
 assert.equal(ui.ids['stadium-select'].value,'桐生');assert.equal(ui.ids['race-select'].value,'1R');
 assert.equal(ui.ids['start-btn'].disabled,false);assert.equal(ui.stops.length,0);
});
test('closed response resets race without auto-selecting another and reports closed',async()=>{
 const ui=uiHarness(async()=>{throw new PredictionRequestError('closed','private server detail')});
 await ui.click();
 assert.equal(ui.ids['prediction-status'].textContent,'このレースは締切です');
 assert.equal(ui.ids['stadium-select'].value,'桐生');assert.equal(ui.ids['race-select'].value,'');
 assert.equal(ui.ids['start-btn'].disabled,true);assert.equal(ui.stops.length,0);
});
test('status region is directly below START and has a reserved display line',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<button id="start-btn">START<\/button>\s*<p id="prediction-status"[^>]*role="status"[^>]*aria-live="polite"><\/p>/);
 const css=readFileSync(new URL('../ui-reference.css',import.meta.url),'utf8');
 assert.match(css,/\.reference-ui \.prediction-status\s*\{[^}]*min-height:\s*1\.5em/s);
});
test('excluded ST changes cannot invalidate canonical reuse; numeric strings normalize',async()=>{
 const a=fixture(),b=fixture();a.preview_entries[0].start_timing=-.01;b.preview_entries[0].start_timing='F.02';b.entries[0].average_st='0.14';assert.deepEqual(await predictionKeys(a,SCORE_CONFIG.version,'logic'),await predictionKeys(b,SCORE_CONFIG.version,'logic'));
});
test('invalid time-of-day is fail-closed',()=>assert.equal(deadlineState('2026-09-23T24:00:00Z'),'invalid'));
