// Exercises get_ai_input through the local PostgREST endpoint with a synthetic,
// identified fixture. The fixture is always removed; no job or Gemini call occurs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const container='supabase_db_project-012';
const envPath=new URL('../../supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env',import.meta.url);
const envText=readFileSync(envPath,'utf8');
const value=name=>envText.match(new RegExp(`^${name}=(.*)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'')??'';
const serviceKey=value('SUPABASE_SERVICE_ROLE_KEY');
const url='http://127.0.0.1:54321'; // host-published Kong port; the container-only 'kong' alias is not resolvable here
if(!serviceKey)throw new Error('Local service role key is unavailable; its value is never printed');
function psql(path){
  const sql=readFileSync(new URL(path,import.meta.url),'utf8');
  const result=spawnSync('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8',maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw new Error(`local fixture ${path.includes('seed')?'seed':'cleanup'} failed (output withheld)`);
}
function psqlSql(sql){
  const result=spawnSync('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8',maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw new Error('local fixture variant update failed (output withheld)');
}
const raceDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let seeded=false;
try{
  psql('./seed-ai-input-fixture.sql');seeded=true;
  const readInput=async()=>{
    const response=await fetch(`${url}/rest/v1/rpc/race_prediction_get_ai_input`,{method:'POST',headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},body:JSON.stringify({p_race_date:raceDate,p_stadium_code:24,p_race_number:12}),signal:AbortSignal.timeout(10000)});
    if(response.status!==200){await response.body?.cancel();throw new Error(`get_ai_input returned HTTP ${response.status}; response body withheld`);}
    return response.json();
  };
  const input=await readInput();
  assert.deepEqual(input.identity,{raceDate,stadiumCode:24,raceNumber:12});
  assert.equal(input.provenance.sourceCode,'boatraceopenapi-v1');
  assert.equal(input.presence.program,'value');assert.equal(input.presence.preview,'value');
  assert.equal(Object.keys(input.programRaw.racers).length,6);
  for(let boat=1;boat<=6;boat++){
    const entry=input.programRaw.racers[String(boat)];
    assert.equal(entry.entry_number,boat);assert.equal(entry.unknown_api_field.raw,true);
    assert.ok(Object.hasOwn(entry,'racer_registration_number'));assert.ok(Object.hasOwn(entry,'motor_number'));
    assert.equal(entry.national_win_rate,Number((7-boat*0.4).toFixed(2)),'national aggregate must remain an unchanged source fact');
    assert.equal(entry.local_win_rate,Number((6.5-boat*0.3).toFixed(2)),'local aggregate must remain an unchanged source fact');
    assert.equal(entry.motor_top2_percent,40-boat,'motor aggregate must remain an unchanged source fact');
  }
  assert.equal(input.programRaw.result,undefined);assert.equal(input.programRaw.existing_prediction,undefined);
  assert.equal(input.programRaw.racers['1'].place_number,undefined);
  assert.equal(input.programRaw.racers['2'].actual_course,undefined);
  assert.equal(input.programRaw.racers['3'].actual_start_timing,undefined);
  assert.equal(input.previewRaw.racers['1'].start_timing,'F.03');
  assert.equal(input.previewRaw.racers['2'].start_timing,null);
  assert.equal(input.previewRaw.racers['3'].course_number,null);
  assert.equal(input.closedAt!==null,true);
  const initialAgeMinutes=(Date.now()-Date.parse(input.provenance.fetchedAt))/60000;
  assert.ok(initialAgeMinutes>=30&&initialAgeMinutes<=32,'31-minute-old fetchedAt must be preserved');
  const component='a1900000-0000-4000-8000-000000000014';
  const variant=async(presence,raw)=>{
    const rawJson=raw===null?'null':`'${JSON.stringify(raw).replaceAll("'","''")}'::jsonb`;
    psqlSql(`update race_data.snapshot_races set preview_presence='${presence}' where preview_component_id='${component}'; update race_data.race_components set raw_json=${rawJson} where id='${component}';`);
    const value=await readInput();
    assert.equal(value.presence.preview,presence,`presence ${presence}`);
    assert.deepEqual(value.previewRaw,raw,`raw ${presence}`);
  };
  await variant('missing',null);
  await variant('null',null);
  await variant('empty',{});
  await variant('empty',[]);
  const rawVariant={racers:{1:{start_timing:'F.03',course_number:null,raw_extension:'kept'}}};
  await variant('value',rawVariant);
  for(const age of [11,31]){
    psqlSql(`update race_data.ingestion_runs set fetched_at=clock_timestamp()-interval '${age} minutes' where id='a1900000-0000-4000-8000-000000000017';`);
    const stale=await readInput();
    const ageMinutes=(Date.now()-Date.parse(stale.provenance.fetchedAt))/60000;
    assert.ok(ageMinutes>=age-0.1&&ageMinutes<=age+0.5,`${age}-minute fetchedAt must be preserved`);
  }
  psqlSql("update race_data.ingestion_runs set fetched_at=null where id='a1900000-0000-4000-8000-000000000017';");
  const unknownTime=await readInput();assert.equal(unknownTime.provenance.fetchedAt,null);
  console.log('PASS: local PostgREST get_ai_input retained all six synthetic raw entries and recursively removed result/prediction facts');
  console.log('PASS: real RPC distinguished missing/null, empty object/array and untouched raw preview variants');
  console.log('PASS: real RPC preserved 11/31-minute-old fetchedAt and unknown fetchedAt without changing the source timestamp');
  console.log('INFO: synthetic fixture only; no AI job, Gemini request, hosted project access, or deployment');
}finally{
  if(seeded)psql('./cleanup-ai-input-fixture.sql');
}
