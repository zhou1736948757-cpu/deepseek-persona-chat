# DeepSeek Persona

基于开源 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 深度改造的极简本地 AI 人格对话桌面/网页应用：**内置免费模型池（开箱即用）· 24 题深度人格问卷 + MBTI 捏人 · 历史聊天一键导入 · 本地 Raw RAG 记忆 · CC-Switch 多模型与向量一键拉取切换 · 自定义 TTS 与声音克隆**。

---

## 一键安装（Windows 推荐 · 安装即用）

前往本仓库 **[Releases 页面](https://github.com/zhou1736948757-cpu/deepseek-persona-chat/releases/latest)** 下载单文件安装程序：

- **`DeepSeek-Persona-Setup-v0.1.5-win-x64.exe`**（约 35 MB）
- 另提供免服务器静态包 **`DeepSeek-Persona-Bilibili-Toy-v0.1.5.zip`**（适用于 B站 Toy 托管与浏览器静态部署）

特性：
- **零环境依赖**：内置私有 Node.js 运行时、生产前端与内置 OurFreeModel 服务，**无需提前安装 Node.js**。
- **免管理员权限**：默认安装至 `%LOCALAPPDATA%\DeepSeekPersona`，自动创建桌面与开始菜单快捷方式并注册到 Windows「应用和功能」。
- **原生系统托盘**：无黑框静默驻留托盘，自动打开浏览器，支持一键重启后台服务、打开免费模型控制台、查看日志与优雅退出；卸载干净不留残留。
- 支持静默部署参数：`/S /D=自定义目录`（可选 `/NOLAUNCH`）。

---

## 核心功能

1. **内置免费模型池（OurFreeModel v2.9.0）**：
   - 项目已预装并自动同源代理，零配置开箱即可切换二十余个免费模型（如 `deepseek-v4.1-flash-free` 等）；也支持在弹窗中按引导填入 DeepSeek 官方 API Key 解锁原生深度思考、联网搜索与流式 TTS。
2. **CC-Switch 风格自定义模型管理（LLM & 向量）**：
   - 支持保存多套自定义 LLM（兼容 **OpenAI `/chat/completions`** 与 **Anthropic `/messages`** 双协议，内置硅基流动 / OpenRouter / Ollama / OpenAI / Anthropic 模板）与多套 Embedding 向量源（支持免 Key 的本机 Ollama 与硅基流动免费 `BAAI/bge-m3`）。
   - **一键拉取模型名**：点击「一键拉取模型」自动请求 `GET /models` 并同步到下拉选择框与首页顶部胶囊快捷切换。
3. **自定义 TTS 入口与声音克隆工作台**：
   - 三种朗读模式：`自动模式`（有 DS Key 走官方流式，无 Key 自动降级免费浏览器人声）、`DeepSeek 官方`、`自定义 TTS & 克隆`。
   - 支持硅基流动 **CosyVoice2**、OpenAI `/v1/audio/speech` 与本地 **Fish-Speech**；支持上传 3–15 秒参考音频（存在本地 IndexedDB）+ 参考文本，一键启用克隆音色或注册硅基流动云端克隆 Voice URI。
4. **人格管理、24 题深度问卷 + MBTI 捏人 & 聊天导入**：
   - 支持从 0 通过 24 题聚焦问卷 + 12 题 MBTI 四维测试捏出专属人格（支持自定义第一眼气质与当前模型润色）。
   - 支持直接导入 DeepSeek 导出 `ZIP`、通用 `JSONL / JSON / Markdown / TXT`，自动将历史对话沉淀为本地记忆。
5. **本地 Raw RAG 记忆（零配置即用）**：
   - 原始对话自动切片存入本机 IndexedDB：零配置时使用纯本地 BM25 召回，填入硅基流动（首充 1 元激活免费 `BAAI/bge-m3`）或本机 Ollama 向量源后自动升级为语义向量 + BM25 混合召回；每条回复透明展示命中的记忆片段。
6. **思考深度、极简交互与全端响应式适配**：
   - 输入框开启「深度思考」后可直接调节思考深度（`低 / 中 / 高`）；支持会话级人格绑定、自动生成会话标题与回复后自动朗读。
   - **手机端与 Pad 端深度适配**：针对 `< 768px` 手机与 `768px–1279px` Pad 竖/横屏定制了毛玻璃抽屉侧边栏、手机底部 Sheet 弹窗、安全区（`viewport-fit=cover` / `safe-area-inset`）与防 iOS 缩放表单；零横向溢出。
7. **B站 Toy 免服务器版与 3D 交互展示页**：
   - 独立静态构建目标 `pnpm build:toy`（桌面安装包默认完全离线隔离，不加载外部 SDK）：集成 B站 Toy JS SDK，支持零自建服务器的端到端 AES-256-GCM 加密云存档（128 槽位分片同步配置与人格，聊天记录与 Raw RAG 100% 留存本机 IndexedDB）及带官方二维码的人格名片海报分享。
   - `docs/` 目录提供纯静态 60fps 3D 交互展示页，可直接启用 GitHub Pages 浏览。

---

## 开发者本地运行与重新打包

```bash
# 安装依赖
pnpm install

# 拉取内置 OurFreeModel 精简运行时（约 5.8 MB）
pnpm sync:ofm

# 启动本地开发服务（同时自动拉起内置 OurFreeModel）
pnpm dev

# 类型检查
pnpm type

# 一键重新构建单文件 Windows 安装包（输出至 release/）
pnpm build:win

# 构建 B站 Toy 免服务器静态压缩包（输出至 dist-toy/ 与 release/）
pnpm build:toy
```

---

## 开源致谢与协议

- 本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT License）开发。
- 内置免费模型独立运行时基于 [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)（MIT License）。
- 遵循 [MIT License](./LICENSE)。
