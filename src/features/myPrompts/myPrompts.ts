/**
 * Composes the My Prompts feature and exposes its public API.
 */
import {
  initAutocomplete,
  initializePromptAutocomplete,
  insertIntoChatGPTInput,
} from './promptAutocomplete';
import {
  clearAllMyPrompts,
  copyPromptText,
  deletePrompt,
  exportMyPrompts,
  getMyPrompts,
  getMyPromptsSnapshot,
  importMyPrompts,
  initializePromptLibrary,
  insertPrompt,
  onPromptsChanged,
  saveMyPrompts,
  showDialog,
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
  getMyPromptsSnapshot,
  saveMyPrompts,
  onPromptsChanged,
  deletePrompt,
  clearAllMyPrompts,
  copyPromptText,
  exportMyPrompts,
  importMyPrompts,
  insertPrompt,
  showDialog,
  initAutocomplete,
  insertIntoChatGPTInput,
};
