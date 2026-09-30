import test from 'node:test';
import assert from 'node:assert/strict';
import { runAiGeneration } from './ai-generation.mjs';
import { DEFAULT_AI_CONFIG } from './ai-config.mjs';
import { createDiagnosticLogger } from './ai-diagnostics.mjs';
import { pollAiBundlePrediction } from './client.mjs';

const valid={main:[1,2,3],counter:[2,3,4],hole:[6,5,4],narrative:'展開'};
const input={identity:{raceDate:'2026-09-27',stadiumCode:1,raceNumber:1},facts:{program:{racers:{}}},provenance:{}};
const output=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(valid)}]}}]});
const rateLimited=()=>Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429,headers:{'retry-after':'2'}});

 test('T01 one 20-second transient failure retries once and saves before shared 90-second deadline',async()=>{
  let clock=0,sends=0,wait=[];const attempts=[];let saved=0;
  await runAiGeneration({job:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ownerToken:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:new Date(90000).toISOString(),inputBundle:input},
    config:DEFAULT_AI_CONFIG,apiKey:'fake',diagnostics:createDiagnosticLogger({}, {enabled:false}),now:()=>clock,sleep:async ms=>{wait.push(ms);clock+=ms;},fetchImpl:async()=>{
      sends++;if(sends===1){clock+=20000;throw Object.assign(new Error('temporary'),{cause:{code:'ECONNRESET'}});}return output();
    },store:{beginAttempt:async()=>({sendAuthorized:true}),finishAttempt:async x=>{attempts.push(x);return {recorded:true};},finishPrediction:async()=>{saved++;return {saved:true};},failPrediction:async()=>assert.fail('should not fail')}});
  assert.equal(sends,2);assert.deepEqual(wait,[1000]);assert.equal(attempts[0].unknown,true);assert.equal(saved,1);assert.ok(clock<90000);
});

test('M08 burst across six distinct race jobs respects per-job maximum and handles simulated project RPM 429',async()=>{
  const requests=new Map(),saved=[];
  const jobs=Array.from({length:6},(_,i)=>{
    const id=`${String(i+1).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    return runAiGeneration({job:{id,ownerToken:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:new Date(90000).toISOString(),inputBundle:input},
      config:DEFAULT_AI_CONFIG,apiKey:'fake',diagnostics:createDiagnosticLogger({}, {enabled:false}),now:()=>0,sleep:async()=>{},fetchImpl:async()=>{
        const count=(requests.get(id)??0)+1;requests.set(id,count);
        // Model a project-level burst: the first three independent jobs get HTTP 429.
        return count===1 && i<3 ? rateLimited() : output();
      },store:{beginAttempt:async()=>({sendAuthorized:true}),finishAttempt:async()=>({recorded:true}),
        finishPrediction:async()=>{saved.push(id);return {saved:true};},failPrediction:async()=>assert.fail('rate-limit recovery should succeed')}});
  });
  await Promise.all(jobs);
  assert.equal(saved.length,6);assert.equal(new Set(saved).size,6);
  assert.equal([...requests.values()].reduce((a,b)=>a+b,0),9);
  assert.ok([...requests.values()].every(count=>count<=2));
  assert.equal(requests.get('00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),2);
  assert.equal(requests.get('00000006-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),1);
});


test('T07 shared-job polling continues beyond five reads and succeeds within 60 seconds',async()=>{
  let clock=0,starts=0,reads=0;
  const bundle={status:'success',mode:'ai_bundle',contractVersion:'ai-bundle-v1',main:[1,2,3],counter:[2,3,4],hole:[6,5,4],narrative:'complete'};
  const pending={status:202,body:{status:'generating',mode:'ai_bundle',contractVersion:'ai-bundle-v1',jobId:'job-60s',remainingMs:60000}};
  const result=await pollAiBundlePrediction(async()=>{starts++;return pending;},async()=>{reads++;return reads<=6?pending:{status:200,body:bundle};},
    {now:()=>clock,sleep:async ms=>{clock+=ms;}});
  assert.equal(starts,1);assert.equal(reads,7);assert.ok(clock<60000);assert.equal(result.narrative,'complete');
});
