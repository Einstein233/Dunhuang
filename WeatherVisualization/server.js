import express from 'express';
import axios from 'axios';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

const XF_API_KEY = 'Bearer ecbe9b409c13f16599382107704af949';
const XF_API_URL = 'https://spark-api-open.xf-yun.com/v2/chat/completions';

app.post('/api/llmchat', async (req, res) => {
  try {
    const { messages } = req.body;
    const xfRes = await axios.post(
      XF_API_URL,
      {
        model: "x1",
        user: "user_id",
        messages: messages,
        stream: false,
        tools: [
          {
            type: "web_search",
            web_search: {
              enable: true,
              search_mode: "deep"
            }
          }
        ]
      },
      {
        headers: {
          "Authorization": XF_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    res.json(xfRes.data);
  } catch (e) {
    console.error("==== 服务器捕获到错误 ====");
    console.error(e);
    if (e.response) {
      console.error("返回内容:", e.response.data);
      res.status(500).json({ error: e.response.data });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

app.listen(4000, () => {
  console.log('中转服务器已启动 http://localhost:4000');
});
