<template>
  <div class="llm-chat-container">
    <!-- <div class="chat-header">
      <div class="header-title-row">
        <span class="header-title">数据库智能问答助手</span>
      </div>
      <div class="chat-subtitle">请在下方输入您想查询数据库的问题</div>
    </div> -->
    <div class="chat-body" ref="chatBody">
      <transition-group name="fade" tag="div">
        <div
          v-for="msg in messages"
          :key="msg.id"
          :class="['message-wrapper', msg.role]"
        >
          <div class="avatar">
            <span v-if="msg.role === 'user'">🧑</span>
            <span v-else>🤖</span>
          </div>
          <div class="message-bubble">
            <div class="bubble-content">{{ msg.content }}</div>
            <!-- LLM 回应功能设计，如复制内容、重新回答等等 -->
            <!-- <div v-if="msg.role === 'assistant'" class="bubble-actions">
              <button class="copy-btn" @click="copyToClipboard(msg.content)">复制</button>
              <button class="retry-btn" @click="regenerateAnswer(msg)">重新回答</button>
            </div> -->
            
            <!-- <div class="bubble-meta">
              <span class="timestamp">{{ msg.timestamp }}</span>
            </div> -->
          </div>
        </div>
      </transition-group>
      <div v-if="loading" class="message-wrapper assistant">
        <div class="avatar"><span>🤖</span></div>
        <div class="message-bubble loading">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    </div>
    <div class="chat-input">
      <textarea
        v-model="inputText"
        @keyup.enter.exact.prevent="sendMessage"
        :rows="1"
        @input="autoResize"
        placeholder="请输入查询问题"
        ref="chatInput"
      ></textarea>
      <button :disabled="loading || !inputText.trim()" @click="sendMessage">
        发送
      </button>
    </div>
  </div>
</template>

<script>
import CryptoJS from "crypto-js";

export default {
  data() {
    return {
      inputText: "",
      messages: [],
      loading: false,
      ws: null,        // WebSocket 实例
      wsConnected: false,
      appid: "f8671469",
      apikey: "ecbe9b409c13f16599382107704af949",
      apisecret: "YjZlMTQ5MmFmNDJmMjc1NDk5ODE0ZWY2",
      domain: "x1",
      Spark_url: "wss://spark-api.xf-yun.com/v1/x1",
      answerBuffer: "",     // 回答缓存
      isFirstcontent: false // 推理链首帧标识
    };
  },
  methods: {
    // 多轮消息管理
    getText(role, content) {
      this.messages.push({
        id: Date.now() + Math.random(),
        role,
        content,
        timestamp: new Date().toLocaleTimeString()
      });
    },
    // 保证最多 8000 字节历史
    checklen() {
      let total = 0;
      for (let i = this.messages.length - 1; i >= 0; i--) {
        total += this.messages[i].content.length;
        if (total > 8000) {
          this.messages.splice(0, i + 1);
          break;
        }
      }
    },
    // 生成签名 WebSocket URL
    createWsUrl() {
      const host = "spark-api.xf-yun.com";
      const path = "/v1/x1";
      const apiKey = this.apikey;
      const apiSecret = this.apisecret;
      // 1. RFC1123时间
      const now = new Date();
      const rfc1123Date = now.toUTCString(); // 保持和python一致即可

      // 2. 拼 signature_origin 字符串
      const signatureOrigin =
        `host: ${host}\n` +
        `date: ${rfc1123Date}\n` +
        `GET ${path} HTTP/1.1`;

      // 3. HMAC-SHA256
      const signatureSha = CryptoJS.HmacSHA256(signatureOrigin, apiSecret);
      const signature = CryptoJS.enc.Base64.stringify(signatureSha);

      // 4. 拼 authorization_origin
      const authorizationOrigin =
        `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

      // 5. 整个 authorizationOrigin 做 base64
      const authorization = btoa(authorizationOrigin);

      // 6. 生成最终url
      return `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(rfc1123Date)}&host=${encodeURIComponent(host)}`;
    },
    sendMessage() {
      const text = this.inputText.trim();
      if (!text) return;
      this.getText("user", text);
      this.inputText = "";
      this.loading = true;
      this.answerBuffer = "";
      this.isFirstcontent = false;
      this.checklen();

      // 多轮历史数组（严格 array of {role,content}）
      const historyArr = this.messages
        .filter(msg => msg.role === "user" || msg.role === "assistant")
        .map(msg => ({ role: msg.role, content: msg.content }));

      let body = {
        header: {
          app_id: this.appid,
          uid: "1234"
        },
        parameter: {
          chat: {
            domain: this.domain,
            temperature: 1.2,
            max_tokens: 32768
          }
        },
        payload: {
          message: {
            text: historyArr
          }
        }
      };

      // 关闭旧连接
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      const url = this.createWsUrl();
      this.ws = new WebSocket(url);
      let that = this;

      this.ws.onopen = function () {
        that.wsConnected = true;
        that.ws.send(JSON.stringify(body));
      };

      this.ws.onmessage = function (event) {
        const data = JSON.parse(event.data);
        // debug log
        console.log("收到数据：", data);

        if (data.header && data.header.code !== 0) {
          that.getText("assistant", "模型返回错误：" + (data.header.message || data.header.code));
          that.loading = false;
          return;
        }

        // 判断流式内容
        if (
          data.payload &&
          data.payload.choices &&
          data.payload.choices.text &&
          data.payload.choices.text.length > 0
        ) {
          const chunk = data.payload.choices.text[0];
          let needUpdate = false; // 标志是否有新内容

          // 推理链内容
          // if ('reasoning_content' in chunk && chunk.reasoning_content) {
          //   that.answerBuffer += "[推理链] " + chunk.reasoning_content + "\n";
          //   that.isFirstcontent = true;
          //   needUpdate = true;
          // }
          // 普通内容
          if ('content' in chunk && chunk.content) {
            if (that.isFirstcontent) {
              that.answerBuffer += "\n*******************以上为思维链内容，模型回复内容如下********************\n";
              that.isFirstcontent = false;
            }
            that.answerBuffer += chunk.content;
            needUpdate = true;
          }
          // 有新内容就立即展示（避免卡住没显示）
          if (needUpdate) {
            // 始终只展示最后一条 assistant 消息，避免重复插入多条
            let lastMsg = that.messages[that.messages.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.content = that.answerBuffer;
            } else {
              that.getText("assistant", that.answerBuffer);
            }
            that.$nextTick(that.scrollToBottom);
          }
          // 2 表示流式响应已结束
          if (chunk.status === 2) {
            that.answerBuffer = "";
            that.loading = false;
            that.ws.close();
            that.wsConnected = false;
          }
        }
      };
      this.ws.onerror = function () {
        that.getText("assistant", "连接失败，请重试。");
        that.loading = false;
      };
      this.ws.onclose = function () {
        that.wsConnected = false;
        that.loading = false;
      };
    },
    scrollToBottom() {
      const container = this.$refs.chatBody;
      if (container) container.scrollTop = container.scrollHeight;
    },
    autoResize(e) {
      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  },
  mounted() {
    this.scrollToBottom();
  }
};
</script>



<style scoped>
.llm-chat-container {
  display: flex;
  border-radius: 15px;
  overflow: hidden;
  flex-direction: column;
  height: 97.8%;
  background: #ffffff;
  box-sizing: border-box;
}

.chat-header {
  flex-shrink: 0;
  padding: 1.1rem 2.5rem 0.8rem 2.5rem;
  background: rgba(255,255,255,0.7);
  border-radius: 0 0 18px 18px;
  box-shadow: 0 2px 12px 0 rgba(52,118,225,0.07);
  border-bottom: 1.5px solid #ebedf0;
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(2px);
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.header-icon {
  font-size: 2rem;
}

.header-title {
  font-size: 1.45rem;
  font-weight: 700;
  color: #2b3353;
  letter-spacing: 1px;
}

.chat-subtitle {
  margin: 0.7rem 0 0 0rem;
  font-size: 1rem;
  color: #8a94a6;
  opacity: 0.95;
  font-weight: 400;
  letter-spacing: 0.3px;
}

.chat-body {
  flex: 1 1 0;
  overflow-y: auto;
  padding: 1.1rem 0.5rem 1rem 0.5rem;
  background-color: #ffffff;
  box-shadow: 0 1px 4px 0 rgba(180,210,240,0.08);
  min-height: 0;
}

.fade-enter-active, .fade-leave-active {
  transition: all 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

.message-wrapper {
  display: flex;
  margin-bottom: 1.1rem;
  align-items: flex-end;
  max-width: 92%;
}

.message-wrapper.user {
  flex-direction: row-reverse;
  margin-left: auto;
}

.message-wrapper.assistant {
  margin-right: auto;
}

.avatar {
  width: 25px;
  height: 45px;
  margin: 0 0.6rem;
  font-size: 1.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-bubble {
  min-width: 32px;
  max-width: 500px;
  padding: 0.63rem 0.8rem;
  border-radius: 16px;
  font-size: 1rem;
  line-height: 1.7;
  background: #e6f7ff;
  color: #2d3553;
  box-shadow: 0 2px 8px rgba(52,118,225,0.06);
  position: relative;
  word-break: break-word;
  animation: fadeIn 0.3s;
  transition: box-shadow 0.2s;
}

.message-wrapper.assistant .message-bubble {
  background: #f0f1f5;
  color: #333;
}

.bubble-meta {
  font-size: 0.75rem;
  color: #aaa;
  text-align: right;
  margin-top: 4px;
}

.typing-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin: 0 2px;
  border-radius: 50%;
  background: #b3b3b3;
  opacity: 0.5;
  animation: blink 1s infinite alternate;
}
.typing-dot:nth-child(2) { animation-delay: .2s; }
.typing-dot:nth-child(3) { animation-delay: .4s; }

@keyframes blink {
  to { opacity: 1; background: #47c6e7; }
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(16px);}
  to { opacity: 1; transform: none;}
}

.chat-input {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
  padding: 0.3rem 0.6rem;
  background: #fafbfc;
  border-top: 1px solid #ecedef;
  position: sticky;
  bottom: 0;
  z-index: 10;
  flex-shrink: 0;
}

.chat-input textarea {
  flex: 1;
  min-height: 28px;
  max-height: 120px;
  resize: none;
  overflow-y: hidden;
  padding: 0.5rem 0.6rem;
  border: 1.5px solid #e3e8f3;
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  background: #fff;
  color: #000000;
  transition: border-color 0.2s;
}

.chat-input textarea:focus {
  border-color: #2d8cf0;
}

.chat-input button {
  background: linear-gradient(90deg, #3880ff, #32d3c7 120%);
  color: #fff;
  padding: 0.4rem 1.3rem;
  font-size: 1.04rem;
  border: none;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(56,128,255,0.07);
  cursor: pointer;
  transition: background 0.2s;
  min-width: 70px;
}

.chat-input button:disabled {
  background: #b1b1b1;
  cursor: not-allowed;
  color: #eee;
}

.bubble-actions {
  margin-top: 6px;
  display: flex;
  gap: 0.8rem;
}

.copy-btn,
.retry-btn {
  font-size: 0.9rem;
  color: #3880ff;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 4px;
  transition: background 0.15s;
}

.copy-btn:hover,
.retry-btn:hover {
  background: #e6f2ff;
}
</style>
