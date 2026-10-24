import { describe, expect, it, vi } from 'vitest';
import { createPromptUsageWriteCoordinator, PROMPT_USAGE_COMMIT_TYPE } from '@/features/myPrompts/promptUsageWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';
const request = (action: string, extra: Record<string, unknown> = {}) => ({ type: PROMPT_USAGE_COMMIT_TYPE, action, ...extra });
function backing(initial: Record<string, unknown> = {}) {
 const state: Record<string, unknown>={ 'lumaToc:myPromptsV1': [{ id: 'p', ownerId: 'account-1', title: 'p', content: 'p', createdAt: 1, updatedAt: 1 }], ...initial };let failNext=false;
 const get=vi.fn(async()=>({'lunaToc:promptUsageV1':state['lunaToc:promptUsageV1'],'lumaToc:myPromptsV1':state['lumaToc:myPromptsV1']}));
 const set=vi.fn(async(values:Record<string,unknown>)=>{if(failNext){failNext=false;throw new Error('quota exceeded');}Object.assign(state,values);});
 return {state,get,set,storage:{get,set} as unknown as Pick<chrome.storage.StorageArea,'get'|'set'>,failOnce:()=>{failNext=true;}};
}
describe('background prompt usage coordinator',()=>{
 it('serializes increments across callers without losing a count',async()=>{
  const box=backing({'lunaToc:promptUsageV1':{p:{usageCount:0,lastUsedAt:1}}}),queue=createSerialWriteQueue();
  const a=createPromptUsageWriteCoordinator(box.storage,queue),b=createPromptUsageWriteCoordinator(box.storage,queue);
  const results=await Promise.all([a.commit(request('record-use',{promptId:'p'})),b.commit(request('record-use',{promptId:'p'}))]);
  expect(results.every(r=>r.ok)).toBe(true);expect((box.state['lunaToc:promptUsageV1'] as Record<string,{usageCount:number}>).p.usageCount).toBe(2);expect(box.set).toHaveBeenCalledTimes(2);
 });
 it('reconciles orphan entries, removes missing IDs and clears the map',async()=>{
  const prompt=(id:string)=>({id,ownerId:'account-1',title:id,content:id,createdAt:1,updatedAt:1});
  const box=backing({'lumaToc:myPromptsV1':[prompt('keep'),prompt('new')],'lunaToc:promptUsageV1':{keep:{usageCount:2,lastUsedAt:3},orphan:{usageCount:4,lastUsedAt:5},new:{usageCount:1,lastUsedAt:2}}}),writer=createPromptUsageWriteCoordinator(box.storage);
  // A stale tab only reports "keep"; the coordinator uses the current durable list and preserves "new".
  expect(await writer.commit(request('reconcile',{validPromptIds:['keep']}))).toEqual({ok:true,usage:{keep:{usageCount:2,lastUsedAt:3},new:{usageCount:1,lastUsedAt:2}}});
  expect(await writer.commit(request('remove',{promptId:'missing'}))).toEqual({ok:true,usage:{keep:{usageCount:2,lastUsedAt:3},new:{usageCount:1,lastUsedAt:2}}});expect(await writer.commit(request('clear'))).toEqual({ok:true,usage:{}});
 });
 it('rejects invalid requests and malformed stored data without overwriting it',async()=>{
  const box=backing({'lunaToc:promptUsageV1':'corrupt'}),writer=createPromptUsageWriteCoordinator(box.storage);
  expect(await writer.commit(request('record-use',{promptId:'p'}))).toEqual({ok:false,error:'Prompt usage storage contains invalid data; refusing to overwrite it'});
  expect(await writer.commit(request('record-use',{promptId:''}))).toEqual({ok:false,error:'Invalid prompt usage request'});expect(box.set).not.toHaveBeenCalled();
 });
 it('keeps the shared queue usable after a storage rejection',async()=>{
  const box=backing({'lunaToc:promptUsageV1':{}}),writer=createPromptUsageWriteCoordinator(box.storage);box.failOnce();
  expect(await writer.commit(request('record-use',{promptId:'p'}))).toEqual({ok:false,error:'quota exceeded'});expect((await writer.commit(request('record-use',{promptId:'p'})).then(r=>r.ok))).toBe(true);
 });
});
