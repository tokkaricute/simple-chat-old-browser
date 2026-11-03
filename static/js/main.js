document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const sidebar = document.getElementById('sidebar');
    const sessionList = document.getElementById('session-list');
    const newSessionBtn = document.getElementById('new-session-btn');
    const modelSelect = document.getElementById('model-select');
    const systemPromptNameInput = document.getElementById('system-prompt-name');
    const systemPromptContentInput = document.getElementById('system-prompt-content');
    const userPromptInput = document.getElementById('user-prompt');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const chatMessages = document.getElementById('chat-messages');

    let currentSessionId = null;
    let appConfig = null;

    // Helper for cache busting
    const getCacheBustedUrl = (url) => {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}t=${new Date().getTime()}`;
    };

    // Initialization
    async function init() {
        console.log("Initializing app...");
        try {
            const config = await fetchConfig();
            if (!config) return;
            appConfig = config;

            // Always load models regardless of mode
            const modelLoadingPromise = loadModels(config);

            if (config.mode === 'ephemeral') {
                console.log("Running in ephemeral mode.");
                if (sidebar) sidebar.style.display = 'none';
                // Use a random UUID for the session in ephemeral mode
                currentSessionId = crypto.randomUUID();
            } else {
                console.log("Running in persistent mode.");
                // Load sessions for persistent mode
                await loadSessions();
            }

            // Wait for models to be loaded
            await modelLoadingPromise;

            setupEventListeners();
        } catch (e) {
            console.error("Critical error during init:", e);
        }
    }

    async function fetchConfig() {
        try {
            const url = getCacheBustedUrl('/api/config');
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
            const config = await response.json();
            
            if (systemPromptNameInput) systemPromptNameInput.value = config.default_system_prompt_name || "";
            if (config.system_prompts && config.default_system_prompt_name) {
                const prompt = config.system_prompts[config.default_system_prompt_name];
                if (prompt && systemPromptContentInput) {
                    systemPromptContentInput.value = prompt.content || "";
                }
            }
            return config;
        } catch (e) {
            console.error('Error fetching configuration:', e);
            return null;
        }
    }

    async function loadSessions() {
        try {
            const url = getCacheBustedUrl('/api/sessions');
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch sessions');
            const sessions = await response.json();
            sessionList.innerHTML = '';
            sessions.forEach(session => {
                const li = document.createElement('li');
                li.textContent = session.name;
                if (String(session.id) === String(currentSessionId)) li.classList.add('active');
                li.addEventListener('click', () => selectSession(session.id));
                sessionList.appendChild(li);
            });
        } catch (e) {
            console.error('Error loading sessions:', e);
        }
    }

    async function selectSession(sessionId) {
        currentSessionId = sessionId;
        await loadMessages(sessionId);
    }

    async function loadMessages(sessionId) {
        try {
            const url = getCacheBustedUrl(`/api/sessions/${sessionId}/messages`);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch messages');
            const messages = await response.json();
            chatMessages.innerHTML = '';
            messages.forEach(msg => appendMessage(msg.role, msg.content));
        } catch (e) {
            console.error('Error loading messages:', e);
        }
    }

    async function loadModels(config) {
        try {
            const url = getCacheBustedUrl('/api/models');
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            modelSelect.innerHTML = ''; // Clear existing options

            const models = data.models || [];
            let defaultModelFound = false;
            const targetDefaultModel = (config && config.default_llm_model) ? config.default_llm_model.trim() : null;

            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);

                if (targetDefaultModel && model.trim() === targetDefaultModel) {
                    defaultModelFound = true;
                }
            });

            if (targetDefaultModel) {
                if (defaultModelFound) {
                    modelSelect.value = targetDefaultModel;
                } else {
                    console.warn(`Default model "${targetDefaultModel}" not found in available models:`, models);
                    modelSelect.value = '';  // 空文字列にして sendMessage() で default_llm_model がフォールバックされるようにする
                }
            }
        } catch (e) {
            console.error('Error loading models:', e);
        }
    }

    function appendMessage(role, content) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', role);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        contentDiv.textContent = content;

        msgDiv.appendChild(contentDiv);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return contentDiv; // Return the element that actually contains the text
    }

    async function createNewSession() {
        try {
            const url = getCacheBustedUrl('/api/sessions');
            const response = await fetch(url, { method: 'POST' });
            if (!response.ok) throw new Error('Failed to create session');
            return await response.json();
        } catch (e) {
            console.error('Error creating session:', e);
            return null;
        }
    }

    async function deleteSession(sessionId) {
        try {
            const url = getCacheBustedUrl(`/api/sessions/${sessionId}`);
            const response = await fetch(url, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete session');
            await loadSessions();
        } catch (e) {
            console.error('Error deleting session:', e);
        }
    }

    async function sendMessage() {
        const content = userPromptInput.value.trim();
        if (!content) return;

        if (!currentSessionId) {
            const newSession = await createNewSession();
            if (!newSession) return; 
            currentSessionId = newSession.id;
            if (appConfig && appConfig.mode !== 'ephemeral') {
                await loadSessions(); 
            }
        }

        userPromptInput.value = '';
        appendMessage('user', content);

        const selectedModel = modelSelect.value ? modelSelect.value.trim() : '';
        const fallbackModel = appConfig && appConfig.default_llm_model ? appConfig.default_llm_model.trim() : '';
        const finalModel = selectedModel || fallbackModel;

        const systemPromptName = systemPromptNameInput.value;
        const systemPromptContent = systemPromptContentInput.value;

        const payload = {
            session_id: currentSessionId,
            message: content,
            model: finalModel,
            system_prompt: systemPromptContent || systemPromptName
        };

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Chat API error: ${response.status} - ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const assistantMsgDiv = appendMessage('assistant', '');

            let fullText = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;
                assistantMsgDiv.textContent = fullText;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        } catch (e) {
            console.error('Chat error details:', e);
            appendMessage('assistant', `[エラーが発生しました: ${e.message}]`);
        }
    }

    async function clearCurrentSession() {
        if (!currentSessionId) return;
        
        if (appConfig && appConfig.mode === 'ephemeral') {
            chatMessages.innerHTML = '';
            currentSessionId = crypto.randomUUID(); 
            return;
        }

        if (!confirm('現在のチャット履歴を消去しますか？')) return;

        try {
            await deleteSession(currentSessionId);
            currentSessionId = null;
            chatMessages.innerHTML = '';
        } catch (e) {
            console.error('Error clearing session:', e);
        }
    }

    function setupEventListeners() {
        newSessionBtn.addEventListener('click', async () => {
            const session = await createNewSession();
            if (session) {
                currentSessionId = session.id;
                await loadSessions();
                await loadMessages(session.id);
            }
        });
        sendBtn.addEventListener('click', sendMessage);
        clearBtn.addEventListener('click', clearCurrentSession);
        userPromptInput.addEventListener('keydown', (e) => {
            // パターンB: Enterキーによる送信を完全に無効化。
            // 送信は必ず「送信ボタン」のクリックによってのみ行われる。
            if (e.key === 'Enter') {
                // 改行を許可したい場合は e.preventDefault() を呼ばない。
                // 送信処理 (sendMessage) は絶対に実行しない。
            }
        });
    }

    init();
});
