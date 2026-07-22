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

const promptsStore = createPromptStore();

initializePromptLibrary({
  promptsStore,
  insertIntoChatGPTInput,
});

initializePromptAutocomplete({
  getMyPrompts,
  sortMyPrompts,
  getActiveSort,
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
