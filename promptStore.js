/**
 * Shared prompt storage helper for ChatTOC My Prompts.
 */
(function () {
  const storageKey = 'chatToc:myPrompts';

  function isContextValid() {
    return (
      typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id
    );
  }

  function createPromptsStore() {
    let cache = [];
    let hydratePromise = null;
    const listeners = new Set();

    function getCacheCopy() {
      return [...cache];
    }

    function setCache(prompts) {
      cache = Array.isArray(prompts) ? [...prompts] : [];
    }

    function notifyListeners() {
      const prompts = getCacheCopy();
      listeners.forEach((listener) => {
        try {
          listener(prompts);
        } catch (e) {
          // Ignore listener failures.
        }
      });
    }

    function wait(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }

    function readPromptsRecord() {
      return new Promise((resolve, reject) => {
        if (!isContextValid()) {
          reject(new Error('Invalid extension context'));
          return;
        }

        chrome.storage.local.get(storageKey, (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }

          resolve(result);
        });
      });
    }

    function readPromptsList(result) {
      return Array.isArray(result[storageKey])
        ? [...result[storageKey]]
        : [];
    }

    async function hydrateFromStorage(maxAttempts = 3) {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await readPromptsRecord();
          return readPromptsList(result);
        } catch (error) {
          if (attempt < maxAttempts) {
            await wait(80 * attempt);
          }
        }
      }

      return getCacheCopy();
    }

    function hydrate() {
      if (!hydratePromise) {
        hydratePromise = hydrateFromStorage().then((prompts) => {
          setCache(prompts);
          return getCacheCopy();
        });
      }

      return hydratePromise;
    }

    if (isContextValid()) {
      try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local') return;

          const promptChange = changes[storageKey];
          if (!promptChange) return;

          setCache(promptChange.newValue || []);
          notifyListeners();
        });
      } catch (e) {
        // Ignore listener registration failures.
      }
    }

    return {
      async getAll() {
        await hydrate();
        return getCacheCopy();
      },
      async saveAll(prompts) {
        const nextPrompts = Array.isArray(prompts) ? [...prompts] : [];
        await hydrate();
        const previousPrompts = getCacheCopy();
        setCache(nextPrompts);

        if (!isContextValid()) {
          notifyListeners();
          return;
        }

        return new Promise((resolve, reject) => {
          chrome.storage.local.set({ [storageKey]: nextPrompts }, () => {
            if (chrome.runtime.lastError) {
              setCache(previousPrompts);
              reject(chrome.runtime.lastError);
              return;
            }

            notifyListeners();
            resolve();
          });
        });
      },
      subscribe(listener) {
        if (typeof listener !== 'function') {
          return () => {};
        }

        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  window.ChatTocPromptStore = {
    create: createPromptsStore,
  };
})();
