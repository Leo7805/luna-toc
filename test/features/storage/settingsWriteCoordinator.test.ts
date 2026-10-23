import { describe, expect, it, vi } from 'vitest';
import { createSettingsWriteCoordinator, SETTINGS_COMMIT_TYPE } from '@/features/storage/settingsWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';
describe('background settings coordinator',()=>{
 it('validates preferences and serializes them with the shared queue',async()=>{
  const data:Record<string,unknown>={},set=vi.fn(async(values:Record<string,unknown>)=>{Object.assign(data,values);}),remove=vi.fn(async(key:string)=>{delete data[key];});
  const storage={set,remove} as unknown as Pick<chrome.storage.StorageArea,'set'|'remove'>,queue=createSerialWriteQueue(),writer=createSettingsWriteCoordinator(storage,queue);
  const theme={followChatGPT:false,manualTheme:'light' as const},sidebar={layoutMode:'side-by-side' as const,backgroundColor:'blue' as const,revealTint:true};
  expect(await Promise.all([writer.commit({type:SETTINGS_COMMIT_TYPE,action:'theme',settings:theme,removeLegacy:true}),writer.commit({type:SETTINGS_COMMIT_TYPE,action:'sidebar',settings:sidebar})])).toEqual([{ok:true},{ok:true}]);
  expect(data['chatToc:themeSettings']).toEqual(theme);expect(data['chatToc:sidebarPreferences']).toEqual(sidebar);expect(remove).toHaveBeenCalledWith('chatToc:theme');
  expect(await writer.commit({type:SETTINGS_COMMIT_TYPE,action:'sidebar',settings:{layoutMode:'invalid'}})).toEqual({ok:false,error:'Invalid settings update request'});
 });
});
