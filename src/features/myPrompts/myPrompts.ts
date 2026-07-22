/**
 * Composes the My Prompts feature and exposes its public API.
 */
import {
  initAutocomplete,
  initializePromptAutocomplete,
  insertIntoChatGPTInput,
} from './promptAutocomplete';
import {
  getActiveSort,
  getMyPrompts,
  initializePromptLibrary,
  onPromptsChanged,
  renderMyPrompts,
  saveMyPrompts,
  showDialog,
  sortMyPrompts,
} from './promptLibrary';
import { createPromptStore } from './promptStore';
import { createPromptUsageStore } from './promptUsageStore';

const promptsStore = createPromptStore();
const promptUsageStore = createPromptUsageStore();

initializePromptLibrary({
  promptsStore,
  promptUsageStore,
  insertIntoChatGPTInput,
});

initializePromptAutocomplete({
  getMyPrompts,
  getPromptUsage: promptUsageStore.getAll,
  recordPromptUse: promptUsageStore.recordUse,
});

export const myPrompts = {
  getMyPrompts,
  saveMyPrompts,
  onPromptsChanged,
  showDialog,
  renderMyPrompts,
  initAutocomplete,
  insertIntoChatGPTInput,
};
