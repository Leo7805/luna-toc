/**
 * Composes the My Prompts feature and exposes its public API.
 */
import {
  initAutocomplete,
  initializePromptAutocomplete,
  insertIntoChatGPTInput,
} from './promptAutocomplete';
import {
  getMyPrompts,
  initializePromptLibrary,
  onPromptsChanged,
  renderMyPrompts,
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

// Reconcile orphaned usage entries once when the extension loads.
void promptsStore.getAll()
  .then((prompts) => promptUsageStore.reconcile(prompts.map((prompt) => prompt.id)))
  .catch(() => undefined);

initializePromptAutocomplete({
  getMyPrompts,
  getPromptUsage: promptUsageStore.getAll,
  recordPromptUse: promptUsageStore.recordUse,
});

export const myPrompts = {
  getMyPrompts,
  onPromptsChanged,
  showDialog,
  renderMyPrompts,
  initAutocomplete,
  insertIntoChatGPTInput,
};
