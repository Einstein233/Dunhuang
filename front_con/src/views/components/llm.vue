<template>
  <div class="agent-page">
    <section class="hero-card">
      <div class="hero-copy">
        <h2>敦煌智能查询</h2>
        <p>已接入本地 `sql-agent` 服务，支持流式 SQL 分析和结果可视化。</p>
      </div>
      <div class="hero-actions">
        <div class="status-pill">
          <span class="status-dot" :class="{ online: agentOnline }"></span>
          <span>{{ agentOnline ? "Agent 在线" : "Agent 未连接" }}</span>
        </div>
        <button class="tool-btn ghost" @click="reloadAgent">刷新窗口</button>
        <button class="tool-btn primary" @click="showFileDialog">
          <i class="el-icon-download"></i>
          文件下载
        </button>
      </div>
    </section>

    <section class="agent-frame-wrap">
      <iframe
        :key="frameKey"
        class="agent-frame"
        :src="agentUiUrl"
        frameborder="0"
        allow="microphone"
        title="sql-agent"
      ></iframe>
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
      showFileModal: false,
      files: [],
      frameKey: 0,
      agentOnline: false,
      agentUiUrl: process.env.VUE_APP_AGENT_UI_URL || "http://localhost:3001",
      agentApiBase: process.env.VUE_APP_AGENT_API_BASE || "http://localhost:3001",
      backApiBase: process.env.VUE_APP_BACKEND_BASE || "http://localhost:3000",
      statusTimer: null
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
        let res = await fetch(`${this.agentApiBase}/api/context`, { method: "GET" });
        if (!res.ok) {
          // 兼容旧版 agent（未提供 /api/context）
          res = await fetch(this.agentUiUrl, { method: "GET" });
        }
        this.agentOnline = res.ok;
      } catch (err) {
        this.agentOnline = false;
      }
    },
    reloadAgent() {
      this.frameKey += 1;
      this.checkAgentStatus();
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
        if (!res.ok) {
          throw new Error("获取文件列表失败");
        }

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
        alert(message);
        this.showFileModal = false;
      }
    },
    async downloadFile(file) {
      try {
        const filepath = file.path || file.name;
        const url = `${this.backApiBase}/file/files/public/download?filepath=${encodeURIComponent(filepath)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`下载失败: ${res.status}`);
        }

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
        alert("文件下载失败");
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

.agent-frame-wrap {
  max-width: 1280px;
  margin: 0 auto;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(16, 50, 93, 0.12);
  box-shadow: 0 18px 40px rgba(13, 56, 102, 0.12);
  background: #fff;
}

.agent-frame {
  width: 100%;
  height: calc(100vh - 250px);
  min-height: 680px;
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

@media (max-width: 960px) {
  .hero-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .agent-frame {
    height: calc(100vh - 300px);
    min-height: 560px;
  }
}
</style>
