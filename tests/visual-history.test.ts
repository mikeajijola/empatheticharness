import test from 'node:test';
import assert from 'node:assert/strict';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { recentScreenshots } from '../agent/lib/visual-history';
test('keeps five screenshot payloads and all prior task, action and text context without mutating evidence', () => {
  const prompt: LanguageModelV4Prompt = [{ role:'user', content:[{type:'text',text:'Original goal'}] }];
  for(let i=0;i<9;i++){
    prompt.push({role:'assistant',content:[{type:'text',text:'Observation '+i},{type:'tool-call',toolCallId:String(i),toolName:'screen',input:{}}]});
    prompt.push({role:'tool',content:[{type:'tool-result',toolCallId:String(i),toolName:'screen',output:{type:'content',value:[{type:'text',text:'Viewport 1024x640'},{type:'file',mediaType:'image/png',data:{type:'data',data:'image'+i}}]}}]});
  }
  const before=JSON.stringify(prompt), after=JSON.stringify(recentScreenshots(prompt));
  assert.equal(JSON.stringify(prompt),before);
  assert.equal((after.match(/"type":"file"/g)||[]).length,5);
  assert.ok(after.includes('Original goal') && after.includes('Observation 0') && after.includes('Observation 8'));
  assert.ok(!after.includes('"data":"image3"') && after.includes('"data":"image4"'));
  assert.equal(recentScreenshots(prompt).length,prompt.length);
});
