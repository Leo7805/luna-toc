(() => {
  const HOOK_FLAG = '__conversationNavigatorFetchHookInstalled';
  const MESSAGE_TYPE = 'CHATGPT_CONVERSATION_DATA';
  const CONVERSATION_API_PATH = '/backend-api/conversation/';
  const SEND_MESSAGE_PATH = '/backend-api/f/conversation';

  let streamBuffer = '';

  if (window[HOOK_FLAG]) {
    return;
  }

  window[HOOK_FLAG] = true;
  console.log('✅ [Navigator] hook installed');

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);

    try {
      const input = args[0];
      const init = args[1] || {};
      const url = getFetchUrl(input);

      if (!url) {
        return response;
      }

      const method = getFetchMethod(input, init);
      const pathname = new URL(url, window.location.origin).pathname;

      const isConversationGet =
        method === 'GET' && pathname.startsWith(CONVERSATION_API_PATH);

      const isSendMessage = method === 'POST' && pathname === SEND_MESSAGE_PATH;

      if (isConversationGet) {
        console.log('✅ [Navigator] fetch:', url);

        postConversationData(response);
      }

      if (isSendMessage) {
        console.log('✅ [Navigator] fetch:', url);

        streamBuffer = '';
        inspectStream(response).catch((error) => {
          console.warn('[Navigator] stream inspect failed:', error);
        });
      }
    } catch (error) {
      console.warn('[Navigator] fetch hook error:', error);
    }

    return response;
  };

  function getFetchUrl(input) {
    if (typeof input === 'string') {
      return input;
    }

    if (input instanceof Request) {
      return input.url;
    }

    return input?.url || '';
  }

  function getFetchMethod(input, init) {
    return (
      init.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
  }

  function postConversationData(response) {
    response
      .clone()
      .json()
      .then((data) => {
        window.postMessage(
          {
            type: MESSAGE_TYPE,
            payload: data,
          },
          '*'
        );
      })
      .catch(() => {});
  }

  async function inspectStream(response) {
    const reader = response.clone().body?.getReader();

    if (!reader) return;

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (streamBuffer.trim()) {
          processStreamLine(streamBuffer);
          streamBuffer = '';
        }

        break;
      }

      streamBuffer += decoder.decode(value, {
        stream: true,
      });

      processBufferedStream();
    }
  }

  function processBufferedStream() {
    const lines = streamBuffer.split('\n');

    // The last line may be incomplete.
    streamBuffer = lines.pop() || '';

    for (const line of lines) {
      processStreamLine(line);
    }
  }

  function processStreamLine(line) {
    if (!line.startsWith('data: ')) {
      return;
    }

    const jsonText = line.slice(6).trim();

    if (!jsonText || jsonText === '[DONE]') {
      return;
    }

    try {
      const data = JSON.parse(jsonText);

      if (data.type === 'input_message') {
        const message = data.input_message;

        window.postMessage(
          {
            type: 'CHATGPT_NEW_USER_MESSAGE',
            payload: {
              id: message.id,
              content: message.content,
              metadata: message.metadata,
              createTime: message.create_time || Date.now(),
            },
          },
          '*'
        );
      }
    } catch (error) {
      console.warn('[Navigator] Stream parse failed:', error);
    }
  }

  console.log('Conversation fetch hook installed');
})();
