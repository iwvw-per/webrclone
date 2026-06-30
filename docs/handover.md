# WebRclone Agent 交接文档 (Handover Document)

本文件是为承接或参与该项目的 AI 代理（Agent）提供的详细工程和技术交接指南，以确保代码质量、架构规范及样式要求的严密执行。

---

## 1. 目录结构与架构 (Directory Structure & Architecture)

项目划分为 `backend` (Go 后端) 和 `frontend` (React 前端) 两部分：

```
webrclone/
├── backend/                  # Go 后端源码
│   ├── bin/                  # 运行期 rclone 存放目录
│   ├── config.go             # rclone.conf 解析与管理
│   ├── main.go               # HTTP 路由、嵌入静态资源与 Basic Auth 模块
│   ├── rclone.go             # rclone.exe 自动下载、解压与版本管理
│   └── tasks.go              # rclone 进程启动、-P 实时解析与任务持久化
├── docs/                     # 文档目录
│   ├── PRD.md                # 产品需求文档
│   └── handover.md           # 本交接文档
└── frontend/                 # React 前端源码
    ├── dist/                 # 静态打包输出 (由 go:embed 引用)
    ├── package.json          # 声明本地 Kumo 库依赖及 peerDeps
    ├── vite.config.ts        # Vite 打包与代理设置
    └── src/                  # React 代码 (全套使用 Kumo 交互)
```

---

## 2. 后端核心设计规范 (Backend Core Specifications)

### 2.1 任务执行与实时解析
1. 后端调用 `rclone` 时必须强制添加 `-P` 标志以获取控制台进度输出。
2. 每一个后台任务使用一个 `exec.Cmd` 实例启动，并通过管道 `Stderr` 和 `Stdout` 读取数据。
3. 对每行数据使用正则表达式实时提取传输速率 (e.g. `12.3 MiB/s`)、整体百分比 (e.g. `45%`) 和剩余时间 (e.g. `1m30s`)：
   - 提取速率：`(\d+(?:\.\d+)?)\s*([a-zA-Z]+/s)`
   - 提取百分比：`(\d+)%`
   - 提取时间：`ETA\s*(\S+)`
4. 任务列表和运行日志序列化持久化至 `backend/tasks_db.json` 文件中，每次读写需要对任务列表加锁（使用 `sync.Mutex`）。

### 2.2 基础认证与安全
- 实现 HTTP Basic Auth 中间件，对所有 `/api/*` 请求以及前端静态页面请求进行校验。
- 用户名密码可以在启动时通过环境变量配置或使用硬编码默认值（`admin/admin`）。

---

## 3. 前端组件使用规范 (Frontend & Kumo UI Component Specifications)

> [!WARNING]
> **严禁在 React 前端中自行编写 HTML 基础组件（自绘），必须 100% 导入 Kumo 里的组件。**

根据 `E:\Code\kumo资料\kumo-component-registry.md` 记载，主要组件导入如下：

### 3.1 布局与卡片
- **整体框架/侧边栏**：使用 `Sidebar` (Category: Other) 组件展示页面侧导航，使用 `Surface` (Category: Layout) 作为主内容区域底色卡片。
- **栅格系统**：使用 `Grid` (Category: Layout) 组件来进行页面的多列和响应式布局，避免自绘 Flexbox。

### 3.2 表单与输入
- **按钮**：使用 `Button` (Category: Action) 组件。
- **输入框**：使用 `Input` 或 `SensitiveInput` (用于密码和秘钥) 与 `InputGroup`。
- **选择框**：使用 `Select` (Category: Input) 组件用于 remotes 列表或操作指令选择。
- **表单域包裹**：使用 `Field` 组件配合 Label 以及 Tooltip 展示。

### 3.3 数据与反馈
- **进度**：使用 `Meter` (Category: Display) 组件展示任务传输进度百分比。
- **标签**：使用 `Badge` (Category: Display) 组件展示远程存储类型、任务状态（运行中/成功/失败）。
- **加载状态**：使用 `Loader` (Category: Feedback) 展示 rclone 下载或配置文件更新的加载中状态。
- **表格**：使用 `Table` (Category: Other) 展示 Remotes 列表和任务历史。
- **弹窗**：使用 `Dialog` (Category: Overlay) 来创建 remote 的新建和编辑框。
- **轻量提示**：使用 `Banner` 或 `Toasty` (Category: Feedback) 显示全局操作成功/失败通知。

### 3.4 样式加载
- 在 `src/index.css` 中只导入 Kumo 提供的预编译 CSS：
  ```css
  import "@cloudflare/kumo/styles";
  ```
- 默认支持 light/dark 自动切换，无需使用 `dark:` 类。

---

## 4. 构建与部署工作流 (Build & Deployment Workflow)

1. **编译 Kumo 库**：在 `E:\Code\kumo资料\kumo` 执行 `pnpm --filter @cloudflare/kumo build` 生成打包文件。
2. **连接前端**：在 `frontend/` 目录运行 `npm install`。这会将 `package.json` 中的 `"@cloudflare/kumo": "file:../../kumo资料/kumo/packages/kumo"` 本地依赖安装到 `node_modules`。
3. **打包前端**：在 `frontend/` 目录运行 `npm run build` 生成 `dist/` 目录。
4. **编译后端**：在 `backend/` 目录运行 `go build -o webrclone.exe`，该操作会通过 `go:embed` 把前端静态资源整体打包至单个 Go 二进制程序中。
