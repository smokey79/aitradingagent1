const {test}=require('node:test');
const assert=require('node:assert/strict');
const {reviewAllowance}=require('../orchestrator/reviewBudget');
const {runConsensus}=require('../orchestrator/consensus');

test('four local review sessions per UTC day with six-hour spacing',()=>{
  const start=Date.UTC(2026,9,20); let state={};
  for(let n=0;n<4;n++){
    const result=reviewAllowance(state,start+n*6*3600000);
    assert.equal(result.approved,true); state=result.nextState;
  }
  assert.equal(reviewAllowance(state,start+23*3600000).reason,'daily_review_cap');
  assert.equal(reviewAllowance(state,start+24*3600000).approved,true);
});
test('cooldown and corrupt budget states reject review',()=>{
  const now=Date.UTC(2026,9,20,12);
  assert.equal(reviewAllowance({day:'2026-10-20',used:1,lastReviewAt:now-1000},now).approved,false);
  assert.equal(reviewAllowance({day:'2026-10-20',used:-1},now).approved,false);
});
test('budget rejection causes zero model calls',async()=>{
 let calls=0;
 const report=await runConsensus('BTC/USDT',{snapshotId:'s'},{
 reserveReview:()=>({approved:false,reason:'review_cooldown'}),
 reviewer:{getSignal:async()=>{calls++;}}
 });
 assert.equal(calls,0); assert.equal(report.status,'review_skipped');
});
test('two local roles run sequentially on the same snapshot',async()=>{
 let active=0,maxActive=0; const roles=[];
 const result=await runConsensus('BTC/USDT',{snapshotId:'s'},{
 reserveReview:()=>({approved:true}),
 reviewer:{getSignal:async(_,data)=>{
   active++;maxActive=Math.max(maxActive,active);
   roles.push(data.analysisRole);assert.equal(data.snapshotId,'s');
   await Promise.resolve();active--;return {signal:'neutral',confidence:0.5};
 }}
 });
 assert.equal(roles.join(','),'bull,bear');assert.equal(maxActive,1);
 assert.equal(result.executionAllowed,false);
});
