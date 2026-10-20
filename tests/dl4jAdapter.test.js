const { test } = require('node:test');
const assert = require('node:assert/strict');
const { predictDl4j, FEATURE_VERSION } = require('../agents/prediction/dl4jPredictor');

function fixture() {
  const now = Math.floor(Date.now() / 900000) * 900000 + 5000;
  const close = now - 5000;
  const bars = Array.from({length: 30}, (_, i) =>
    [close - (30-i)*900000, 100+i, 102+i, 99+i, 101+i, 20+i]);
  const snapshot = {id: 'a'.repeat(64), timeframe:'15m', candleClose:close, candles:{bars}};
  const response = {status:'shadow_only',snapshotId:snapshot.id,featureVersion:FEATURE_VERSION,
    asOfMs:close,scoreUp:0.6,trainedThroughMs:close-900000,modelId:'fixture',modelSha256:'b'.repeat(64)};
  return {now,snapshot,response};
}

test('DL4J attaches valid score and model identity without execution permission',async()=>{
  const f=fixture();
  const result=await predictDl4j('BTC/USDT',f.snapshot,{env:{},now:()=>f.now,
    http:{post:async(url,request)=>{assert.equal(request.features.length,12);return {data:f.response};}}});
  assert.equal(result.scoreUp,0.6); assert.equal(result.executionAllowed,false);
});
test('DL4J rejects wrong snapshots, future training labels and invalid scores',async()=>{
  const f=fixture();
  for(const patch of [{snapshotId:'wrong'},{trainedThroughMs:f.snapshot.candleClose},{scoreUp:NaN}]){
    const result=await predictDl4j('BTC/USDT',f.snapshot,{env:{},now:()=>f.now,
      http:{post:async()=>({data:{...f.response,...patch}})}});
    assert.equal(result.status,'invalid_response');
  }
});
test('DL4J handles missing service/model without invented prediction',async()=>{
  const f=fixture();
  for(const code of [undefined,503]){
    const result=await predictDl4j('BTC/USDT',f.snapshot,{env:{},now:()=>f.now,
      http:{post:async()=>{throw {response:{status:code}};}}});
    assert.equal(result.status,code===503?'model_not_ready':'unavailable');
    assert.equal(result.scoreUp,undefined);
  }
});
test('disabled or stale inputs cause no network call',async()=>{
  const f=fixture(); let calls=0;
  const http={post:async()=>{calls++;}};
  await predictDl4j('BTC/USDT',f.snapshot,{env:{DL4J_ENABLED:'false'},now:()=>f.now,http});
  await predictDl4j('BTC/USDT',f.snapshot,{env:{},now:()=>f.now+130000,http});
  assert.equal(calls,0);
});
