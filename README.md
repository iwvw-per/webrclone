# WebRclone

A beautiful web interface console for Rclone, built with a Go backend and a Vite React frontend powered by the `@cloudflare/kumo` UI component library.

## Features

- **首次部署初始化**：检测首次进入自动引导，设置管理员账号密码保护服务安全。
- **Rclone 程序管理**：支持自动探测/多源重试下载，以及网页端直接拖拽/上传本地 rclone 二进制程序。
- **远程存储配置**：解析、添加、编辑、删除存储配置文件，支持对 `rclone.conf` 进行原始配置可视化编辑。
- **任务管理中心**：启动 copy、sync、move 传输指令，并支持实时百分比进度条、速度、ETA、活动文件和实时控制台日志。
- **自动主题切换**：支持自动适配操作系统的深浅色模式，保持全站中文交互。
- **单一轻量部署**：前端资源编译后完全由 Go 嵌入式发布，提供一个独立无依赖的极小包，或 ~35MB 的 Docker 容器。

---

## Docker Compose 部署

这是用于部署 WebRclone 的最简 `docker-compose.yml` 配置文件。

> [!TIP]
> 如果您打算在 Docker 容器内部使用 `rclone mount` 挂载云盘，容器必须挂载 `/dev/fuse` 硬件设备，并配置 `SYS_ADMIN` 权限。

```yaml
version: '3.8'

services:
  webrclone:
    image: iwvw/webrclone:latest
    container_name: webrclone
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    # 容器内使用 rclone mount 所需权限配置：
    cap_add:
      - SYS_ADMIN
    devices:
      - /dev/fuse:/dev/fuse
    security_opt:
      - apparmor:unconfined
    restart: unless-stopped
```

启动部署：
```bash
docker compose up -d
```

然后，直接在浏览器中打开 `http://localhost:8080` 设置您的首次进入账号和密码！

---

## 本地开发调试

### 1. 启动开发服务器 (热更新)
在根目录下运行，这会并行启动 Go 接口后端与 Vite 前端代理服务器：
```bash
npm install
npm run dev
```
打开浏览器访问 `http://localhost:5173/`。

### 2. 编译生成独立的可执行程序
直接将前端资产打包并编译进 Go 后端（Windows 下输出 `backend/webrclone.exe`，类 Unix 下输出 `backend/webrclone`）：
```bash
npm run build
```
