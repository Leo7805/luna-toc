/**
 * Composes the My Prompts feature and exposes its public API.
 */
(function () {
  const promptsStore = window.ChatTocPromptStore.create();
  const promptLibrary = window.ChatTocPromptLibrary;
  const promptAutocomplete = window.ChatTocPromptAutocomplete;

  promptLibrary.initialize({
    promptsStore,
    insertIntoChatGPTInput: promptAutocomplete.insertIntoChatGPTInput,
  });

  promptAutocomplete.initialize({
    getMyPrompts: promptLibrary.getMyPrompts,
    sortMyPrompts: promptLibrary.sortMyPrompts,
    getActiveSort: promptLibrary.getActiveSort,
  });

  window.ChatTocMyPrompts = {
    getMyPrompts: promptLibrary.getMyPrompts,
    saveMyPrompts: promptLibrary.saveMyPrompts,
    onPromptsChanged: promptLibrary.onPromptsChanged,
    showDialog: promptLibrary.showDialog,
    renderMyPrompts: promptLibrary.renderMyPrompts,
    initAutocomplete: promptAutocomplete.initAutocomplete,
    insertIntoChatGPTInput: promptAutocomplete.insertIntoChatGPTInput,
  };
})();
