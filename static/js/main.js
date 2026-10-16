document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const sessionList = document.getElementById('session-list');
    const newSessionBtn = document.getElementById('new-session-btn');
    const modelSelect = document.getElementById('model-select');
    const systemPromptNameInput = document.getElementById('system-prompt-name');
    const systemPromptContentInput = document.getElementById('system-prompt-content');
    const userPromptInput = document.getElementById('user-prompt');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const chatMessages = document.getElementById('chat-messages');
    const localUrlSpan = document.getElementById('local-url');
    const targetUrlSpan = document.getElementById('target-url');

    let currentSessionId = null;
    let appConfig = null; // Still kept for sendMessage context

    // Helper for cache busting
    const getCacheBustedUrl = (url) => {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}t=${new Date().getTime()}`;
    };

    // Initialization
    async function init() {
        console.log("Initializing app...");
        try {
            // 1. Fetch config and get it directly
            const config = await fetchConfig();
            if (!config) {
                console.error("Failed to initialize: appConfig is null");
                return;
            }
            appConfig = config; // Store for later use in sendMessage

            // 2. Pass the loaded config directly to subsequent functions
            // This avoids Safari's potential timing issues with shared variable access.
            await Promise.all([
                loadSessions(),
                loadModels(config) 
            ]);

            setupEventListeners();
        } catch (e) {
            console.error("Critical error during init:", e);
        }
    }

    async function fetchConfig() {
        try {
            const url = getCacheBustedUrl('/api/config');
            console.log("Fetching configuration from:", url);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
            const config = await response.json();
            console.log("Configuration received:", config);

            if (localUrlSpan) localUrlSpan.textContent = config.api_url;
            if (targetUrlSpan) targetUrlSpan.textContent = config.api_url;
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
                if (session.id === currentSessionId) li.classList.add('active');
                li.addEventListener('click', () => selectSession(session.id));

                const delBtn = document.createElement('span');
                delBtn.textContent = '×';
                delBtn.className = 'delete-session';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                };

                li.appendChild(delBtn);
                sessionList.appendChild(li);
            });
        } catch (e) {
            console.error('Error loading sessions:', e);
        }
    }

    async function loadModels(config) { // Explicitly receive config
        try {
            const url = getCacheBustedUrl('/api/models');
            console.log("Fetching models from:", url);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            const availableModels = data.models || [];
            
            console.log("Available models from API:", availableModels);
            if (config) {
                console.log("Target default model from config:", config.default_llm_model);
            }

            modelSelect.innerHTML = '';
            let matched = false;

            availableModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;

                if (config && config.default_llm_model) {
                    const target = config.default_llm_model.trim().toLowerCase();
                    const current = model.trim().toLowerCase();

                    if (current === target || current.includes(target) || target.includes(current)) {
                        console.log(`>>> MATCH FOUND: "${model}" matches default "${config.default_llm_model}"`);
                        option.selected = true;
                        matched = true;
                    }
                }
                modelSelect.appendChild(option);
            });

            if (!matched && availableModels.length > 0) {
                console.warn("No model matched the default from config. Using first available.");
            }
        } catch (e) {
            console.error('Error loading models:', e);
        }
    }

    async function selectSession(sessionId) {
        console.log("Selecting session:", sessionId);
        currentSessionId = sessionId;
        await loadSessions();
        await loadMessages(sessionId);
    }

    async function loadMessages(sessionId) {
        chatMessages.innerHTML = '';
        try {
            const url = getCacheBustedUrl(`/api/sessions/${sessionId}/messages`);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch messages');
            const messages = await response.json();
            messages.forEach(msg => appendMessage(msg.role, msg.content));
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } catch (e) {
            console.error('Error loading messages:', e);
        }
    }

    function appendMessage(role, content) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        const roleDiv = document.createElement('div');
        roleDiv.className = 'role';
        roleDiv.textContent = role === 'user' ? 'User' : 'Assistant';
        div.appendChild(roleDiv);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.textContent = content;
        div.appendChild(contentDiv);

        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return contentDiv;
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
        if (!confirm('このセッションを削除しますか？')) return;
        try {
            const url = getCacheBustedUrl(`/api/sessions/${sessionId}`);
            const response = await fetch(url, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete session');
            if (currentSessionId === sessionId) {
                currentSessionId = null;
                chatMessages.innerHTML = '';
            }
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
            await loadSessions(); 
        }

        userPromptInput.value = '';
        appendMessage('user', content);

        const selectedModel = modelSelect.value ? modelSelect.value.trim() : "";
        const fallbackModel = appConfig && appConfig.default_llm_model ? appConfig.default_llm_model.trim() : "";
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
    }

    init();
});