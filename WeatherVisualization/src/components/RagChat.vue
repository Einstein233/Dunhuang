<template>
  <div class="rag-chat">
    <!-- 消息区 -->
    <div class="chat-messages" ref="msgContainer">
      <div v-if="messages.length === 0" class="welcome">
        <div class="welcome-icon">🏜️</div>
        <h3>沙舟 · 敦煌科普助手</h3>
        <p>问问关于敦煌的气候、地理、文化吧</p>
        <div class="chips">
          <button @click="sendChip('敦煌为什么这么干燥？')">敦煌为什么这么干燥？</button>
          <button @click="sendChip('介绍一下莫高窟的历史')">介绍一下莫高窟的历史</button>
          <button @click="sendChip('中国有哪些气候区？')">中国有哪些气候区？</button>
          <button @click="sendChip('丝绸之路经过哪些地方？')">丝绸之路经过哪些地方？</button>
        </div>
      </div>

      <div v-for="(msg, i) in messages" :key="i" :class="['msg', msg.role]">
        <div class="msg-avatar">
          <span v-if="msg.role === 'user'">👤</span>
          <span v-else>🏜️</span>
        </div>
        <div class="msg-body">
          <div v-if="msg.loading" class="loading">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
          <div v-else class="msg-text" v-html="renderText(msg.content)"></div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-input">
      <textarea
        v-model="input"
        :disabled="streaming"
        placeholder="输入你的问题…"
        @keydown.enter.exact="send"
        rows="1"
      ></textarea>
      <button :disabled="!input.trim() || streaming" @click="send">
        <span v-if="!streaming">▶</span>
        <span v-else class="spinner"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onBeforeUnmount } from "vue";

const RAG_API = "http://127.0.0.1:3003";

const messages = ref([]);
const input = ref("");
const streaming = ref(false);
const msgContainer = ref(null);

let reader = null;

async function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;
  input.value = "";

  messages.value.push({ role: "user", content: text });
  const aiMsg = { role: "assistant", content: "", loading: true };
  messages.value.push(aiMsg);
  streaming.value = true;
  await scrollToBottom();

  try {
    const history = messages.value
      .slice(0, -1)
      .filter((m) => !m.loading)
      .map((m) => ({ role: m.role, content: m.content }));

    const resp = await fetch(`${RAG_API}/api/rag/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: text, history }),
    });

    reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.chunk) {
            aiMsg.content += data.chunk;
            await scrollToBottom();
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    aiMsg.content = aiMsg.content || "抱歉，连接失败，请确认 RAG 服务已启动。";
  } finally {
    aiMsg.loading = false;
    streaming.value = false;
    reader = null;
  }
}

function sendChip(text) {
  input.value = "";
  messages.value.push({ role: "user", content: text });
  input.value = "";
  nextTick(() => {
    input.value = "";
    const aiMsg = {
      role: "assistant",
      content: "",
      loading: true,
    };
    messages.value.push(aiMsg);
    streaming.value = true;
    doStreamSuggestion(text, aiMsg);
  });
}

async function doStreamSuggestion(text, aiMsg) {
  try {
    const resp = await fetch(`${RAG_API}/api/rag/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: text, history: [] }),
    });
    reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.chunk) {
            aiMsg.content += data.chunk;
            await scrollToBottom();
          }
        } catch (_) {}
      }
    }
  } catch (_) {
    aiMsg.content = aiMsg.content || "抱歉，连接失败。";
  } finally {
    aiMsg.loading = false;
    streaming.value = false;
    reader = null;
  }
}

function renderText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

async function scrollToBottom() {
  await nextTick();
  const el = msgContainer.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onBeforeUnmount(() => {
  if (reader) reader.cancel();
});
</script>

<style scoped>
.rag-chat {
  width: 370px;
  height: 590px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #fff5e6 0%, #fff0d6 100%);
  border-radius: 14px;
  overflow: hidden;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}

/* 消息区 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px 8px;
  scroll-behavior: smooth;
}
.chat-messages::-webkit-scrollbar {
  width: 4px;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(186, 107, 44, 0.25);
  border-radius: 4px;
}

/* 欢迎 */
.welcome {
  text-align: center;
  padding-top: 20px;
  color: #4a2a16;
}
.welcome-icon {
  font-size: 36px;
  margin-bottom: 8px;
}
.welcome h3 {
  font-size: 17px;
  margin: 0 0 6px;
  color: #6b3a1f;
}
.welcome p {
  font-size: 13px;
  margin: 0 0 14px;
  color: rgba(74, 42, 22, 0.6);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.chips button {
  background: rgba(206, 112, 42, 0.1);
  border: 1px solid rgba(206, 112, 42, 0.22);
  color: #8b571f;
  padding: 5px 12px;
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.chips button:hover {
  background: rgba(206, 112, 42, 0.2);
  color: #5c3511;
}

/* 消息 */
.msg {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.msg.user {
  flex-direction: row-reverse;
}
.msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(206, 112, 42, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}
.msg-body {
  max-width: 80%;
}
.msg.user .msg-body {
  text-align: right;
}
.msg-text {
  background: #fff;
  border: 1px solid rgba(206, 112, 42, 0.15);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: #3b2415;
  word-break: break-word;
}
.msg.user .msg-text {
  background: #fae4ce;
  border-color: rgba(206, 112, 42, 0.25);
}
.msg-text :deep(strong) {
  color: #9d4f19;
}
.msg-text :deep(code) {
  background: rgba(186, 107, 44, 0.1);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}

/* 加载 */
.loading .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c0713a;
  margin-right: 4px;
  animation: bounce 1.4s infinite ease-in-out;
}
.loading .dot:nth-child(2) {
  animation-delay: 0.16s;
}
.loading .dot:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

/* 输入 */
.chat-input {
  display: flex;
  align-items: flex-end;
  padding: 8px 10px 10px;
  gap: 6px;
  border-top: 1px solid rgba(206, 112, 42, 0.12);
  background: #fffcf5;
}
.chat-input textarea {
  flex: 1;
  resize: none;
  border: 1px solid rgba(206, 112, 42, 0.22);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  color: #3b2415;
  background: #fffef9;
  max-height: 60px;
}
.chat-input textarea:focus {
  border-color: #c0713a;
}
.chat-input button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #c96022, #d77d34);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.2s;
}
.chat-input button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
