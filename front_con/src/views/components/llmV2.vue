<template>
  <div class="agent-page">
    <section class="hero-card">
      <div class="hero-copy">
        <h2>敦煌智能查询 V2</h2>
        <p>基于 LangGraph + MCP 协议的新一代智能助手，支持自然语言查询和实时数据分析。</p>
      </div>
      <div class="hero-actions">
        <div class="status-pill">
          <span class="status-dot" :class="{ online: agentOnline }"></span>
          <span>{{ agentOnline ? "Agent V2 在线" : "Agent V2 未连接" }}</span>
        </div>
        <button class="tool-btn ghost" @click="clearChat">
          <i class="el-icon-delete"></i>
          清空对话
        </button>
        <button class="tool-btn primary" @click="showFileDialog">
          <i class="el-icon-download"></i>
          文件下载
        </button>
      </div>
    </section>

    <section class="chat-container">
      <div class="chat-messages" ref="messagesContainer">
        <div v-if="messages.length === 0" class="welcome-message">
          <div class="welcome-icon">🤖</div>
          <h3>你好！我是气象数据智能助手</h3>
          <p>我可以帮你查询和分析全国各地的历史气象数据。试试问我：</p>
          <div class="suggestion-chips">
            <button @click="sendSuggestion('敦煌近3个月的温度变化趋势')">敦煌近3个月的温度变化趋势</button>
            <button @click="sendSuggestion('北京和上海去年的降水量对比')">北京和上海去年的降水量对比</button>
            <button @click="sendSuggestion('查询酒泉2024年的平均气温')">查询酒泉2024年的平均气温</button>
          </div>
        </div>

        <div
          v-for="(msg, index) in messages"
          :key="index"
          :class="['message', msg.role]"
        >
          <div class="message-avatar">
            <span v-if="msg.role === 'user'">👤</span>
            <span v-else>🤖</span>
          </div>
          <div class="message-content">
            <div v-if="msg.loading" class="loading-indicator">
              <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span v-if="msg.toolCall" class="tool-call-text">
                正在调用: {{ msg.toolCall }}
              </span>
            </div>
            <div v-else class="message-text" v-html="formatMessage(msg.content)"></div>
          </div>
        </div>
      </div>

      <div class="chat-input-area">
        <div class="input-wrapper">
          <textarea
            v-model="inputText"
            :disabled="isStreaming"
            placeholder="输入你的问题，例如：敦煌近3个月的温度变化趋势"
            @keydown.enter.exact="sendMessage"
            rows="1"
          ></textarea>
          <button
            class="send-btn"
            :disabled="!inputText.trim() || isStreaming"
            @click="sendMessage"
          >
            <i v-if="!isStreaming" class="el-icon-s-promotion"></i>
            <i v-else class="el-icon-loading"></i>
          </button>
        </div>
        <div class="input-hint">按 Enter 发送，Shift + Enter 换行</div>
      </div>
    </section>

    <div v-if="showFileModal" class="modal-overlay" @click.self="closeFileDialog">
      <div class="modal-content">
        <h3>选择要下载的文件</h3>
        <ul class="file-list">
          <li v-for="file in files" :key="file.path || file.name" @click="downloadFile(file)">
            <span class="file-name">{{ file.name }}</span>
            <span class="file-path">{{ file.path }}</span>
          </li>
        </ul>
        <button class="tool-btn danger" @click="closeFileDialog">关闭</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      messages: [],
      inputText: '',
      isStreaming: false,
      agentOnline: false,
      showFileModal: false,
      files: [],
      statusTimer: null,
      agentApiBase: process.env.VUE_APP_AGENT_V2_API || "http://localhost:3002",
      backApiBase: process.env.VUE_APP_BACKEND_BASE || "http://localhost:3000"
    };
  },
  mounted() {
    this.checkAgentStatus();
    this.statusTimer = setInterval(this.checkAgentStatus, 30000);
  },
  beforeDestroy() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
    }
  },
  methods: {
    async checkAgentStatus() {
      try {
        const res = await fetch(`${this.agentApiBase}/health`);
        this.agentOnline = res.ok;
      } catch (err) {
        this.agentOnline = false;
      }
    },

    clearChat() {
      if (this.messages.length === 0) return;
      if (confirm('确定要清空所有对话吗？')) {
        this.messages = [];
      }
    },

    sendSuggestion(text) {
      this.inputText = text;
      this.sendMessage();
    },

    async sendMessage() {
      const text = this.inputText.trim();
      if (!text || this.isStreaming) return;

      this.messages.push({ role: 'user', content: text });
      this.inputText = '';
      this.isStreaming = true;
      this.scrollToBottom();

      const assistantMsgIndex = this.messages.length;
      this.messages.push({
        role: 'assistant',
        content: '',
        loading: true
      });
      this.scrollToBottom();

      try {
        const response = await fetch(`${this.agentApiBase}/api/v2/query/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text, history: [] })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let currentTool = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7).trim();
              const dataLine = lines[i + 1];

              if (dataLine && dataLine.startsWith('data: ')) {
                try {
                  const data = JSON.parse(dataLine.slice(6));

                  if (eventType === 'text') {
                    fullContent += data.chunk || '';
                    this.$set(this.messages, assistantMsgIndex, {
                      role: 'assistant',
                      content: fullContent,
                      loading: false
                    });
                    this.scrollToBottom();
                  } else if (eventType === 'tool_start') {
                    currentTool = data.tool || '';
                    this.$set(this.messages, assistantMsgIndex, {
                      role: 'assistant',
                      content: fullContent,
                      loading: true,
                      toolCall: currentTool
                    });
                    this.scrollToBottom();
                  } else if (eventType === 'tool_end') {
                    currentTool = '';
                    this.$set(this.messages, assistantMsgIndex, {
                      role: 'assistant',
                      content: fullContent,
                      loading: fullContent.length === 0,
                      toolCall: ''
                    });
                  } else if (eventType === 'error') {
                    throw new Error(data.message || '未知错误');
                  }
                } catch (e) {
                  // 解析错误，继续
                }
                i++; // 跳过 data 行
              }
            }
          }
        }

        if (fullContent) {
          this.$set(this.messages, assistantMsgIndex, {
            role: 'assistant',
            content: fullContent,
            loading: false
          });
        } else {
          this.$set(this.messages, assistantMsgIndex, {
            role: 'assistant',
            content: '抱歉，我没有生成有效的回答。',
            loading: false
          });
        }
      } catch (error) {
        console.error('Chat error:', error);
        this.$set(this.messages, assistantMsgIndex, {
          role: 'error',
          content: `请求失败: ${error.message}`
        });
        this.$message.error('与智能助手的连接失败');
      } finally {
        this.isStreaming = false;
        this.scrollToBottom();
      }
    },

    formatMessage(content) {
      return content
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>');
    },

    scrollToBottom() {
      this.$nextTick(() => {
        if (this.$refs.messagesContainer) {
          this.$refs.messagesContainer.scrollTop = this.$refs.messagesContainer.scrollHeight;
        }
      });
    },

    normalizeFileList(raw) {
      if (Array.isArray(raw)) return raw;
      if (raw && Array.isArray(raw.data)) return raw.data;
      if (raw && Array.isArray(raw.files)) return raw.files;
      if (raw && Array.isArray(raw.list)) return raw.list;
      return [];
    },

    async showFileDialog() {
      this.showFileModal = true;
      try {
        const res = await fetch(`${this.backApiBase}/file/files/public/list`);
        if (!res.ok) throw new Error("获取文件列表失败");

        const payload = await res.json();
        if (payload && payload.code === 203) {
          throw new Error("登录失效，请重新登录");
        }

        const normalized = this.normalizeFileList(payload);
        this.files = normalized.map((file) => ({
          name: file.name || String(file),
          path: file.path || file.filepath || String(file)
        }));
      } catch (err) {
        const message = err && err.message ? err.message : "加载文件列表失败";
        this.$message.error(message);
        this.showFileModal = false;
      }
    },

    async downloadFile(file) {
      try {
        const filepath = file.path || file.name;
        const url = `${this.backApiBase}/file/files/public/download?filepath=${encodeURIComponent(filepath)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`下载失败: ${res.status}`);

        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = file.name || "download";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
        this.showFileModal = false;
      } catch (err) {
        this.$message.error("文件下载失败");
      }
    },

    closeFileDialog() {
      this.showFileModal = false;
    }
  }
};
</script>

<style scoped>
.agent-page {
  min-height: calc(100vh - 120px);
  padding: 24px;
  background:
    radial-gradient(circle at 18% 8%, rgba(21, 101, 192, 0.16), transparent 38%),
    radial-gradient(circle at 84% 12%, rgba(0, 150, 136, 0.12), transparent 42%),
    linear-gradient(180deg, #f3f8ff 0%, #f9fcff 100%);
}

.hero-card {
  max-width: 1280px;
  margin: 0 auto 18px;
  padding: 18px 20px;
  border-radius: 16px;
  border: 1px solid rgba(17, 34, 68, 0.09);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 30px rgba(13, 56, 102, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.hero-copy h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #10325d;
}

.hero-copy p {
  margin: 0;
  color: #406181;
  font-size: 14px;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-pill {
  padding: 6px 12px;
  border-radius: 999px;
  background: #eef4fb;
  color: #214b72;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d93025;
}

.status-dot.online {
  background: #1e8e3e;
}

.tool-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-btn.primary {
  background: linear-gradient(135deg, #0f74d8 0%, #00a786 100%);
  color: #fff;
}

.tool-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(15, 116, 216, 0.25);
}

.tool-btn.ghost {
  background: #e8f0fa;
  color: #1a4d77;
}

.tool-btn.ghost:hover {
  background: #d9e8f7;
}

.tool-btn.danger {
  width: 100%;
  margin-top: 14px;
  background: #ea4335;
  color: #fff;
}

.chat-container {
  max-width: 1280px;
  margin: 0 auto;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(16, 50, 93, 0.12);
  box-shadow: 0 18px 40px rgba(13, 56, 102, 0.12);
  background: #fff;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 250px);
  min-height: 680px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: #fafbfc;
}

.welcome-message {
  text-align: center;
  padding: 60px 20px;
  color: #5a6c7d;
}

.welcome-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.welcome-message h3 {
  font-size: 24px;
  color: #10325d;
  margin-bottom: 12px;
}

.welcome-message p {
  font-size: 15px;
  margin-bottom: 24px;
}

.suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
}

.suggestion-chips button {
  background: #e8f0fa;
  border: 1px solid #d0e0f0;
  border-radius: 20px;
  padding: 10px 18px;
  font-size: 14px;
  color: #1a4d77;
  cursor: pointer;
  transition: all 0.2s;
}

.suggestion-chips button:hover {
  background: #d9e8f7;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(15, 116, 216, 0.15);
}

.message {
  display: flex;
  margin-bottom: 20px;
  gap: 12px;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  background: #e8f0fa;
}

.message.user .message-avatar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.message-content {
  max-width: 70%;
  padding: 14px 18px;
  border-radius: 16px;
  word-wrap: break-word;
}

.message.user .message-content {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  background: white;
  color: #333;
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.message.error .message-content {
  background: #fff5f5;
  border: 1px solid #ffd7d7;
  color: #d93025;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.typing-dots {
  display: flex;
  gap: 4px;
}

.typing-dots span {
  width: 8px;
  height: 8px;
  background: #667eea;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-10px); }
}

.tool-call-text {
  font-size: 12px;
  color: #999;
  font-style: italic;
}

.message-text {
  line-height: 1.6;
  font-size: 14px;
}

.message-text :deep(code) {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.chat-input-area {
  padding: 20px;
  background: white;
  border-top: 1px solid #eee;
}

.input-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.input-wrapper textarea {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  max-height: 120px;
  transition: border-color 0.2s;
}

.input-wrapper textarea:focus {
  outline: none;
  border-color: #667eea;
}

.send-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
  text-align: center;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 28, 54, 0.48);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.modal-content {
  width: min(720px, 92vw);
  max-height: 78vh;
  overflow: auto;
  background: #ffffff;
  border-radius: 14px;
  padding: 18px;
}

.modal-content h3 {
  margin: 0 0 12px;
  color: #173d62;
}

.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #e1ecf7;
  border-radius: 10px;
  overflow: hidden;
}

.file-list li {
  padding: 10px 12px;
  border-bottom: 1px solid #edf3fb;
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-list li:last-child {
  border-bottom: none;
}

.file-list li:hover {
  background: #f3f9ff;
}

.file-name {
  color: #1b466f;
  font-weight: 600;
}

.file-path {
  color: #6f89a3;
  font-size: 12px;
  word-break: break-all;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: #999;
}

@media (max-width: 960px) {
  .hero-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .chat-container {
    height: calc(100vh - 300px);
    min-height: 560px;
  }

  .message-content {
    max-width: 85%;
  }
}
</style>
