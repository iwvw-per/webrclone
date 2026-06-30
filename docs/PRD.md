# WebRclone (Kumo) Product Requirements Document (PRD)

## 1. 产品定义 (Product Definition)
WebRclone 是一个运行于本地或服务器的 rclone 可执行程序与任务管理 Web 控制台。它基于 **Go 后端** 和 **React 前端** 构建，前端 UI **严格限制全部使用 Cloudflare Kumo 组件库**，严禁使用原生 HTML 自绘或任意非 Kumo 的第三方 UI 元素，以确保整体视觉设计高度一致、现代化和高品质。

## 2. 核心功能需求 (Core Functional Requirements)

### 2.1 Rclone 主程序管理 (Rclone Binary Management)
- **状态检测**：检测本地 `bin/` 目录下是否存在 `rclone` (或 `rclone.exe`)，并读取当前版本号。
- **一键下载/更新**：自动识别服务器/当前系统的 OS 和架构（Windows/Linux/macOS，amd64/arm64），从官方 `https://downloads.rclone.org/` 下载最新 Zip 包，解压并将可执行程序放置到指定目录，提供实时的下载与解压进度日志展示。

### 2.2 配置文件管理 (Rclone Config Management)
- **路径检测**：自动定位系统默认的 `rclone.conf` 配置文件路径，并允许用户手动配置或修改该路径。
- **配置解析 (Structured Edit)**：解析 INI 格式的 `rclone.conf`，并以结构化 JSON 列表输出所有 Remotes 及其类型和参数。支持新增、修改和删除 remote 节点。
- **原始配置文件编辑 (Raw Edit)**：提供一个文本域，允许直接查看和在线保存修改整个原始 `rclone.conf`。

### 2.3 批量任务管理 (Batch Task Management)
- **新建任务**：用户可以通过表单选择操作类型（Copy、Sync、Move）、源目录（Source Remote + path）、目标目录（Destination Remote + path），并配置额外的命令行选项（如并发限制、带宽限制、排除规则）。
- **实时进度解析**：任务通过后台进程 (`os/exec`) 启动，后端需捕获控制台输出，并通过 `-P` 标志实时解析 rclone 的输出数据：
  - 传输百分比（Percentage）
  - 传输速率（MB/s）
  - 剩余估算时间（ETA）
  - 当前正在传输的文件列表
- **生命周期控制**：可随时停止（Kill 进程）正在运行的任务。
- **任务历史持久化**：所有启动过的任务、当前的运行状态、成功/失败标志以及完整的 stdout/stderr 日志必须序列化存储在本地 `tasks_db.json` 文件中，保证后端重启后历史不丢失。

### 2.4 安全性与前后端合并部署 (Security & Single Binary Deployment)
- **基础认证 (Basic Authentication)**：前后端所有路由和 API 必须使用 HTTP Basic Auth 进行密码防护，用户需要输入凭据（例如默认 `admin/admin` 或配置文件中设置的账号密码）才能访问控制台。
- **前后端合并**：通过 Go 的 `go:embed` 技术，将 React 编译后的 `dist` 目录嵌入到 Go 二进制中。启动 Go 程序即可直接在浏览器中访问管理端（例如 `http://localhost:8080`），无需独立运行 Node 服务。

## 3. 技术栈 (Technology Stack)
- **后端**：Go 1.20+ (仅使用标准库以确保高可移植性)
- **前端**：React 19/18 + TypeScript + Vite + `@cloudflare/kumo` 
- **组件规范**：页面所有交互、表格、输入框、布局、按钮、侧边栏、对话框必须从 `@cloudflare/kumo` 导入，**严禁自行编写 HTML 标签（如 `<button>`、`<input>`、`<table` 等）或非 Kumo 规定的样式类**。
