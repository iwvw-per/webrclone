import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Badge,
  Button,
  Dialog,
  Grid,
  GridItem,
  Input,
  InputArea,
  LayerCard,
  Loader,
  Meter,
  Select,
  Table,
  Text,
  SensitiveInput,
  Toasty,
  useKumoToastManager
} from "@cloudflare/kumo";
import {
  House,
  Cloud,
  ListBullets,
  Download,
  Play,
  Stop,
  Plus,
  Trash,
  ArrowClockwise,
  Eye,
  X,
  CheckCircle,
  FileText
} from "@phosphor-icons/react";

// Types
interface Task {
  id: string;
  command: string;
  source: string;
  destination: string;
  flags: string[];
  status: string;
  progress: number;
  speed: string;
  eta: string;
  transferred: string;
  bytesTransferred?: string;
  filesTransferred?: string;
  activeThreads?: number;
  activeFiles: string[];
  logs: string;
  startTime: string;
  endTime: string;
}

export default function App() {
  return (
    <Toasty>
      <AppContent />
    </Toasty>
  );
}

function AppContent() {
  const toastManager = useKumoToastManager();

  // Authentication State
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem("webRcloneAuth"));

  // Initial setup state
  const [isServerInitialized, setIsServerInitialized] = useState<boolean | null>(null);
  const [setupUser, setSetupUser] = useState("");
  const [setupPass, setSetupPass] = useState("");
  const [isSettingUp, setIsSettingUp] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkAuthStatus = () => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setIsServerInitialized(data.initialized);
        }
      })
      .catch(() => {
        setIsServerInitialized(true); // Fallback
      });
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // Rclone Binary State
  const [rcloneVersion, setRcloneVersion] = useState<string>("Checking...");
  const [downloadStatus, setDownloadStatus] = useState<string>("");

  // Config Remotes State
  const [remotes, setRemotes] = useState<{ [name: string]: { [key: string]: string } }>({});
  const [configPath, setConfigPath] = useState<string>("");
  const [rawConfig, setRawConfig] = useState<string>("");
  const [isEditingRaw, setIsEditingRaw] = useState<boolean>(false);

  // Remotes Edit Modal State
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState<boolean>(false);
  const [editingRemoteName, setEditingRemoteName] = useState<string>("");
  const [remoteNameInput, setRemoteNameInput] = useState<string>("");
  const [remoteTypeInput, setRemoteTypeInput] = useState<string>("sftp");
  const [remoteParams, setRemoteParams] = useState<{ key: string; val: string }[]>([]);

  // Tasks State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState<boolean>(false);
  const [taskCommand, setTaskCommand] = useState<string>("copy");
  const [taskSource, setTaskSource] = useState<string>("");
  const [taskDest, setTaskDest] = useState<string>("");
  const [taskFlags, setTaskFlags] = useState<string>("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Selected Log Task State
  const [isLogsModalOpen, setIsLogsModalOpen] = useState<boolean>(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Authenticated fetch wrapper
  const apiFetch = (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem("webRcloneAuth");
    const headers = {
      ...options.headers,
      "Authorization": token || "",
    };
    return fetch(url, { ...options, headers }).then((res) => {
      if (res.status === 401) {
        localStorage.removeItem("webRcloneAuth");
        setIsAuthenticated(false);
        throw new Error("Unauthorized");
      }
      return res;
    });
  };

  const handleSetup = (e: FormEvent) => {
    e.preventDefault();
    if (!setupUser.trim() || !setupPass.trim()) {
      showNotification("error", "管理员用户名和密码不能为空！");
      return;
    }
    setIsSettingUp(true);
    fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: setupUser.trim(), password: setupPass.trim() }),
    })
      .then((res) => {
        setIsSettingUp(false);
        if (res.ok) {
          showNotification("success", "管理员账户初始化成功！请使用刚设置的账号密码登录。");
          setIsServerInitialized(true);
        } else {
          showNotification("error", "账户初始化失败，请重试。");
        }
      })
      .catch(() => {
        setIsSettingUp(false);
        showNotification("error", "请求失败，网络或服务器错误。");
      });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.startsWith("rclone")) {
      showNotification("error", "上传文件格式不正确，文件必须是 rclone 主程序！");
      return;
    }

    setDownloadStatus("正在上传 Rclone 二进制文件...");
    const formData = new FormData();
    formData.append("file", file);

    apiFetch("/api/rclone/upload", {
      method: "POST",
      body: formData,
    })
      .then((res) => {
        if (res.ok) {
          showNotification("success", "Rclone 主程序二进制文件上传成功！");
          setDownloadStatus("上传完成，已成功部署 Rclone 主程序。");
          fetchRcloneStatus();
        } else {
          showNotification("error", "上传 Rclone 文件失败！");
          setDownloadStatus("上传失败，请检查文件大小或系统权限。");
        }
      })
      .catch(() => {
        showNotification("error", "上传网络请求失败！");
        setDownloadStatus("上传失败：网络或服务器错误。");
      });
  };

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      showNotification("error", "用户名和密码不能为空！");
      return;
    }
    setIsLoggingIn(true);
    const token = "Basic " + btoa(username + ":" + password);

    fetch("/api/rclone/status", {
      headers: { "Authorization": token }
    })
      .then((res) => {
        setIsLoggingIn(false);
        if (res.status === 200) {
          localStorage.setItem("webRcloneAuth", token);
          setIsAuthenticated(true);
          showNotification("success", "登录成功！欢迎使用 WebRclone。");
          // Trigger data fetches after authentication
          setTimeout(() => {
            fetchRcloneStatus();
            fetchConfigPath();
            fetchRemotes();
            fetchTasks();
          }, 100);
        } else if (res.status === 401) {
          showNotification("error", "用户名或密码错误，请重试。");
        } else {
          showNotification("error", "无法连接后端，请检查后端服务。");
        }
      })
      .catch(() => {
        setIsLoggingIn(false);
        showNotification("error", "请求失败，网络或服务器错误。");
      });
  };

  const handleLogout = () => {
    localStorage.removeItem("webRcloneAuth");
    setIsAuthenticated(false);
    showNotification("success", "您已安全退出登录。");
  };

  // Auto theme switcher hook
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      document.documentElement.setAttribute("data-mode", e.matches ? "dark" : "light");
    };
    handleThemeChange(mediaQuery);
    mediaQuery.addEventListener("change", handleThemeChange);
    return () => mediaQuery.removeEventListener("change", handleThemeChange);
  }, []);

  // Fetch initial data
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchRcloneStatus();
    fetchConfigPath();
    fetchRemotes();
    fetchTasks();
  }, [isAuthenticated]);

  // Poll running tasks & download status
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchTasks();
      fetchRcloneStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Poll selected task logs in dialog if task is running
  useEffect(() => {
    if (!isAuthenticated || !isLogsModalOpen || !selectedTask || selectedTask.status !== "running") return;

    const interval = setInterval(() => {
      apiFetch(`/api/tasks?id=${selectedTask.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data) {
            setSelectedTask(data);
            setTimeout(() => {
              logEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 100);
          }
        })
        .catch(() => { });
    }, 1500);

    return () => clearInterval(interval);
  }, [isAuthenticated, isLogsModalOpen, selectedTask?.id, selectedTask?.status]);

  // Scroll logs to bottom on open
  useEffect(() => {
    if (isLogsModalOpen) {
      setTimeout(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 200);
    }
  }, [isLogsModalOpen]);

  const showNotification = (type: "success" | "error", msg: string) => {
    toastManager.add({
      title: type === "success" ? "操作成功" : "发生错误",
      description: msg,
      variant: type === "success" ? "success" : "error",
    });
  };

  const fetchRcloneStatus = () => {
    apiFetch("/api/rclone/status")
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setRcloneVersion(data.version);
          setDownloadStatus(data.downloadStatus);
        }
      })
      .catch(() => { });
  };

  const fetchConfigPath = () => {
    apiFetch("/api/config/path")
      .then((res) => res.json())
      .then((data) => {
        if (data) setConfigPath(data.path);
      })
      .catch(() => { });
  };

  const saveConfigPath = () => {
    apiFetch("/api/config/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: configPath }),
    })
      .then((res) => {
        if (res.ok) {
          showNotification("success", "Rclone 配置文件路径保存成功！");
          fetchRemotes();
        } else {
          showNotification("error", "保存配置文件路径失败！");
        }
      })
      .catch(() => { });
  };

  const fetchRemotes = () => {
    apiFetch("/api/config/remotes")
      .then((res) => res.json())
      .then((data) => {
        if (data) setRemotes(data);
      })
      .catch(() => { });
  };

  const fetchRawConfig = () => {
    apiFetch("/api/config/raw")
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setRawConfig(data.content);
          setIsEditingRaw(true);
        }
      })
      .catch(() => { });
  };

  const saveRawConfig = () => {
    apiFetch("/api/config/raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: rawConfig }),
    })
      .then((res) => {
        if (res.ok) {
          showNotification("success", "原始配置文件保存成功！");
          setIsEditingRaw(false);
          fetchRemotes();
        } else {
          showNotification("error", "保存原始配置文件失败！");
        }
      })
      .catch(() => { });
  };

  const fetchTasks = () => {
    apiFetch("/api/tasks")
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          const sorted = (data as Task[]).sort(
            (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
          );
          setTasks(sorted);
        }
      })
      .catch(() => { });
  };

  // Download Rclone Binary Trigger
  const triggerDownload = () => {
    apiFetch("/api/rclone/download", { method: "POST" })
      .then((res) => {
        if (res.ok) {
          showNotification("success", "下载主程序指令已触发，请在后台查看进度。");
          fetchRcloneStatus();
        } else {
          showNotification("error", "触发主程序下载失败！");
        }
      })
      .catch(() => { });
  };

  // Remote Config Save
  const saveRemote = () => {
    if (!remoteNameInput.trim()) {
      showNotification("error", "存储源名称不能为空！");
      return;
    }

    const paramsObj: { [key: string]: string } = { type: remoteTypeInput };
    remoteParams.forEach((p) => {
      if (p.key.trim()) {
        paramsObj[p.key.trim()] = p.val;
      }
    });

    apiFetch("/api/config/remotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: remoteNameInput.trim(), params: paramsObj }),
    })
      .then((res) => {
        if (res.ok) {
          showNotification("success", `远程存储 ${remoteNameInput} 保存成功！`);
          setIsRemoteModalOpen(false);
          fetchRemotes();
        } else {
          showNotification("error", "保存远程存储配置失败！");
        }
      })
      .catch(() => { });
  };

  const deleteRemote = (name: string) => {
    if (!confirm(`确定要删除配置 ${name} 吗？`)) return;

    apiFetch(`/api/config/remotes?name=${name}`, { method: "DELETE" })
      .then((res) => {
        if (res.ok) {
          showNotification("success", `存储配置 ${name} 已成功删除。`);
          fetchRemotes();
        } else {
          showNotification("error", "删除存储配置失败！");
        }
      })
      .catch(() => { });
  };

  const openEditRemote = (name: string, type: string, params: { [key: string]: string }) => {
    setEditingRemoteName(name);
    setRemoteNameInput(name);
    setRemoteTypeInput(type);

    const plist: { key: string; val: string }[] = [];
    Object.keys(params).forEach((k) => {
      if (k !== "type") {
        plist.push({ key: k, val: params[k] });
      }
    });
    setRemoteParams(plist);
    setIsRemoteModalOpen(true);
  };

  const openNewRemote = () => {
    setEditingRemoteName("");
    setRemoteNameInput("");
    setRemoteTypeInput("sftp");
    setRemoteParams([
      { key: "host", val: "" },
      { key: "user", val: "" },
      { key: "pass", val: "" },
    ]);
    setIsRemoteModalOpen(true);
  };

  // Tasks Spawning
  const launchTask = () => {
    if (!taskSource.trim() || !taskDest.trim()) {
      showNotification("error", "源路径和目标路径不能为空！");
      return;
    }

    const flagsArr = taskFlags.trim() ? taskFlags.trim().split(/\s+/) : [];

    if (editingTaskId) {
      apiFetch("/api/tasks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingTaskId,
          command: taskCommand,
          source: taskSource.trim(),
          destination: taskDest.trim(),
          flags: flagsArr,
        }),
      })
        .then((res) => {
          if (res.ok) {
            restartTask(editingTaskId);
            setIsTaskModalOpen(false);
            setEditingTaskId(null);
          } else {
            showNotification("error", "更新任务配置失败！");
          }
        })
        .catch(() => { });
    } else {
      apiFetch("/api/tasks/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: taskCommand,
          source: taskSource.trim(),
          destination: taskDest.trim(),
          flags: flagsArr,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.id) {
            showNotification("success", "任务启动成功！");
            setIsTaskModalOpen(false);
            setTaskSource("");
            setTaskDest("");
            setTaskFlags("");
            fetchTasks();
          } else {
            showNotification("error", "启动传输任务失败！");
          }
        })
        .catch(() => { });
    }
  };

  const restartTask = (id: string) => {
    apiFetch(`/api/tasks/restart?id=${id}`, { method: "POST" })
      .then((res) => {
        if (res.ok) {
          showNotification("success", "任务已重新启动！");
          fetchTasks();
        } else {
          showNotification("error", "重新启动任务失败！");
        }
      })
      .catch(() => { });
  };

  const stopTask = (id: string) => {
    apiFetch(`/api/tasks/stop?id=${id}`, { method: "POST" })
      .then((res) => {
        if (res.ok) {
          showNotification("success", "任务停止指令已成功发送。");
          fetchTasks();
        } else {
          showNotification("error", "发送停止任务指令失败！");
        }
      })
      .catch(() => { });
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTaskId(task.id);
    setTaskCommand(task.command);
    setTaskSource(task.source);
    setTaskDest(task.destination);
    setTaskFlags(task.flags ? task.flags.join(" ") : "");
    setIsTaskModalOpen(true);
  };

  const openNewTaskModal = () => {
    setEditingTaskId(null);
    setTaskCommand("copy");
    setTaskSource("");
    setTaskDest("");
    setTaskFlags("");
    setIsTaskModalOpen(true);
  };

  const viewTaskLogs = (task: Task) => {
    setSelectedTask(task);
    setIsLogsModalOpen(true);
  };

  // 1. Loading Server Status
  if (isServerInitialized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kumo-base">
        <Loader size="lg" />
      </div>
    );
  }

  // 2. Render Initial Setup Page if NOT Initialized
  if (!isServerInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kumo-base p-4">
        <LayerCard className="w-full max-w-xs p-6 flex flex-col gap-4 bg-kumo-elevated border border-kumo-line rounded-xl">
          <div className="flex flex-col gap-2 items-center text-center">
            <Cloud size={48} className="text-kumo-brand" />
            <Text variant="heading2" as="h2">初始化 WebRclone</Text>
            <Text variant="secondary" size="sm">检测到首次部署，请设置管理员用户名和密码以保障系统安全</Text>
          </div>

          <form onSubmit={handleSetup} className="flex flex-col gap-4">
            <Input
              label="管理员用户名"
              size="sm"
              value={setupUser}
              onChange={(e) => setSetupUser(e.target.value)}
              placeholder="请设置用户名"
              required
            />
            <SensitiveInput
              label="管理员密码"
              size="sm"
              value={setupPass}
              onChange={(e) => setSetupPass(e.target.value)}
              placeholder="请设置密码"
              required
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="mt-2 w-full justify-center"
              disabled={isSettingUp}
            >
              {isSettingUp ? <Loader size="sm" /> : "初始化管理员账户"}
            </Button>
          </form>
        </LayerCard>
      </div>
    );
  }

  // 3. Render Login Form if NOT Authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kumo-base p-4">
        <LayerCard className="w-full max-w-xs p-6 flex flex-col gap-4 bg-kumo-elevated border border-kumo-line rounded-xl">
          <div className="flex flex-col gap-2 items-center text-center">
            <Cloud size={48} className="text-kumo-brand" />
            <Text variant="heading2" as="h2">登录 WebRclone</Text>
            <Text variant="secondary" size="sm">请输入您的用户名和密码以访问控制面板</Text>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Input
              label="用户名"
              size="sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
            />
            <SensitiveInput
              label="密码"
              size="sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="mt-2 w-full justify-center"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Loader size="sm" /> : "安全登录"}
            </Button>
          </form>
        </LayerCard>
      </div>
    );
  }

  // 2. Render Main Application UI
  return (
    <div className="flex min-h-screen bg-kumo-base">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-kumo-line bg-kumo-elevated flex flex-col justify-between shrink-0">
        <div>
          {/* Logo & Header */}
          <div className="p-6 border-b border-kumo-line flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Cloud size={24} className="text-kumo-brand" />
              <Text variant="heading3" as="span">
                WebRclone
              </Text>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="p-4 flex flex-col gap-1.5">
            <Button
              variant={activeTab === "dashboard" ? "secondary" : "ghost"}
              className={`w-full justify-start gap-3 ${activeTab === "dashboard" ? "bg-kumo-tint font-bold" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <House size={18} />
              控制面板
            </Button>

            <Button
              variant={activeTab === "remotes" ? "secondary" : "ghost"}
              className={`w-full justify-start gap-3 ${activeTab === "remotes" ? "bg-kumo-tint font-bold" : ""}`}
              onClick={() => setActiveTab("remotes")}
            >
              <Cloud size={18} />
              远程存储
            </Button>

            <Button
              variant={activeTab === "tasks" ? "secondary" : "ghost"}
              className={`w-full justify-start gap-3 ${activeTab === "tasks" ? "bg-kumo-tint font-bold" : ""}`}
              onClick={() => setActiveTab("tasks")}
            >
              <ListBullets size={18} />
              任务管理
            </Button>

            <Button
              variant={activeTab === "rclone_bin" ? "secondary" : "ghost"}
              className={`w-full justify-start gap-3 ${activeTab === "rclone_bin" ? "bg-kumo-tint font-bold" : ""}`}
              onClick={() => setActiveTab("rclone_bin")}
            >
              <Download size={18} />
              程序管理
            </Button>
          </nav>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-kumo-line flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Text variant="secondary" size="xs">当前程序版本:</Text>
            <Text variant="secondary" size="xs" truncate as="code" title={rcloneVersion}>
              {rcloneVersion}
            </Text>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="w-full justify-center">
            退出登录
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 overflow-y-auto flex flex-col gap-4">


        {/* 1. Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <Text variant="heading2" as="h2">控制面板</Text>
                <Text variant="secondary">系统状态概览及活动任务实时监控。</Text>
              </div>
            </div>

            {/* Grid Status Cards */}
            <Grid variant="3up" gap="base">
              <GridItem>
                <LayerCard className="p-5 flex flex-col justify-between h-32 border border-kumo-line rounded-lg bg-kumo-elevated">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <Text variant="secondary" size="xs">Rclone 主程序</Text>
                      <div className="truncate max-w-[140px] font-mono mt-1">
                        <Text variant="heading2" as="span" title={rcloneVersion}>
                          {rcloneVersion}
                        </Text>
                      </div>
                    </div>
                    <Badge variant={rcloneVersion !== "Not Installed" ? "success" : "error"}>
                      {rcloneVersion !== "Not Installed" ? "已就绪" : "未安装"}
                    </Badge>
                  </div>
                  <div className="flex justify-end mt-2">
                    <Button size="sm" variant="outline" onClick={() => setActiveTab("rclone_bin")}>
                      前往管理
                    </Button>
                  </div>
                </LayerCard>
              </GridItem>

              <GridItem>
                <LayerCard className="p-5 flex flex-col justify-between h-32 border border-kumo-line rounded-lg bg-kumo-elevated">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <Text variant="secondary" size="xs">已配置存储源</Text>
                      <div className="mt-1">
                        <Text variant="heading2" as="span">
                          {Object.keys(remotes).length} <Text size="sm" variant="secondary" as="span">个</Text>
                        </Text>
                      </div>
                    </div>
                    <Badge variant="info">已配置</Badge>
                  </div>
                  <div className="flex justify-end mt-2">
                    <Button size="sm" variant="outline" onClick={() => setActiveTab("remotes")}>
                      管理存储
                    </Button>
                  </div>
                </LayerCard>
              </GridItem>

              <GridItem>
                <LayerCard className="p-5 flex flex-col justify-between h-32 border border-kumo-line rounded-lg bg-kumo-elevated">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <Text variant="secondary" size="xs">运行中后台任务</Text>
                      <div className="mt-1">
                        <Text variant="heading2" as="span">
                          {tasks.filter((t) => t.status === "running").length} <Text size="sm" variant="secondary" as="span">个</Text>
                        </Text>
                      </div>
                    </div>
                    <Badge variant={tasks.filter((t) => t.status === "running").length > 0 ? "info" : "neutral"}>
                      {tasks.filter((t) => t.status === "running").length > 0 ? "进行中" : "空闲"}
                    </Badge>
                  </div>
                  <div className="flex justify-end mt-2">
                    <Button size="sm" variant="outline" onClick={() => setActiveTab("tasks")}>
                      查看任务
                    </Button>
                  </div>
                </LayerCard>
              </GridItem>
            </Grid>

            {/* Active Tasks Monitor Section */}
            <LayerCard className="p-4 border border-kumo-line rounded-lg">
              <Text variant="heading3" as="h3">实时运行中任务</Text>
              {tasks.filter((t) => t.status === "running").length === 0 ? (
                <div className="text-center py-8">
                  <Text variant="secondary">当前没有运行中的数据传输任务。</Text>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {tasks
                    .filter((t) => t.status === "running")
                    .map((task) => (
                      <div key={task.id} className="border-b border-kumo-line pb-3 last:border-b-0 last:pb-0">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="flex items-center gap-2">
                              <Badge variant="info">{task.command.toUpperCase()}</Badge>
                              <span className="truncate max-w-xl">
                                <Text bold as="span">
                                  {task.source} &rarr; {task.destination}
                                </Text>
                              </span>
                            </span>
                            <Text variant="secondary" size="xs" as="code">
                              ID: {task.id} | 速度: {task.speed || "--"} | 剩余时间: {task.eta || "--"}
                            </Text>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => viewTaskLogs(task)}>
                              <Eye size={16} />
                              日志
                            </Button>
                            <Button size="sm" variant="secondary-destructive" onClick={() => stopTask(task.id)}>
                              <Stop size={16} />
                              停止
                            </Button>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <Meter
                          label={task.transferred || "正在准备中..."}
                          value={task.progress}
                          showValue={true}
                        />

                        {/* Active transferring files */}
                        {task.activeFiles && task.activeFiles.length > 0 && (
                          <div className="mt-2 pl-2 border-l border-kumo-line flex flex-col gap-1">
                            {task.activeFiles.slice(0, 2).map((file, idx) => (
                              <Text key={idx} variant="secondary" size="xs" truncate as="code">
                                &bull; {file}
                              </Text>
                            ))}
                            {task.activeFiles.length > 2 && (
                              <span className="pl-2 italic">
                                <Text variant="secondary" size="xs" as="span">
                                  ... 还有 {task.activeFiles.length - 2} 个文件正在传输
                                </Text>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </LayerCard>
          </div>
        )}

        {/* 2. Remotes Tab */}
        {activeTab === "remotes" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <Text variant="heading2" as="h2">远程存储</Text>
                <Text variant="secondary">
                  解析并管理配置文件中的远程存储源。当前文件：{configPath}
                </Text>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={fetchRemotes}>
                  <ArrowClockwise size={16} />
                  刷新
                </Button>
                <Button variant="outline" onClick={fetchRawConfig}>
                  <FileText size={16} />
                  编辑原始配置文件
                </Button>
                <Button variant="primary" onClick={openNewRemote}>
                  <Plus size={16} />
                  新增存储源
                </Button>
              </div>
            </div>

            {/* Path Setting card */}
            <LayerCard className="p-3 flex gap-3 items-end border border-kumo-line rounded-lg">
              <div className="flex-1">
                <Input
                  label="Rclone 配置文件路径 (rclone.conf)"
                  size="sm"
                  value={configPath}
                  onChange={(e) => setConfigPath(e.target.value)}
                  placeholder="请输入 rclone.conf 的绝对路径"
                />
              </div>
              <Button size="sm" onClick={saveConfigPath}>保存路径</Button>
            </LayerCard>

            {/* Raw Configuration editing mode */}
            {isEditingRaw && (
              <LayerCard className="p-4 flex flex-col gap-3 border border-kumo-line rounded-lg">
                <div className="flex justify-between items-center">
                  <Text variant="heading3" as="span">修改原始配置文件</Text>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingRaw(false)}>
                    <X size={16} />
                    取消
                  </Button>
                </div>
                <InputArea
                  className="font-mono text-xs h-72 w-full"
                  value={rawConfig}
                  onChange={(e) => setRawConfig(e.target.value)}
                  placeholder="[remote-name]&#10;type = sftp&#10;host = ..."
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setIsEditingRaw(false)}>
                    取消
                  </Button>
                  <Button variant="primary" onClick={saveRawConfig}>
                    保存文件
                  </Button>
                </div>
              </LayerCard>
            )}

            {/* Remotes Table list */}
            <LayerCard className="p-0 overflow-hidden border border-kumo-line rounded-lg">
              <Table className="w-full" style={{ tableLayout: "fixed" }}>
                <Table.Header>
                  <Table.Row>
                    <Table.Head style={{ width: "180px", textAlign: "left" }}>存储源名称</Table.Head>
                    <Table.Head style={{ width: "120px", textAlign: "left" }}>存储类型 (Type)</Table.Head>
                    <Table.Head style={{ textAlign: "left" }}>配置参数明细</Table.Head>
                    <Table.Head style={{ width: "160px", textAlign: "right" }}>操作</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {Object.keys(remotes).length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={4} className="text-center py-8 text-kumo-subtle">
                        暂无配置任何远程存储。您可以点击右上角“新增存储源”或编辑“原始配置文件”。
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    Object.keys(remotes).map((name) => {
                      const remote = remotes[name];
                      const type = remote.type || "unknown";
                      const paramsText = Object.keys(remote)
                        .filter((k) => k !== "type" && k !== "pass")
                        .map((k) => `${k}=${remote[k]}`)
                        .join(", ");

                      return (
                        <Table.Row key={name}>
                          <Table.Cell style={{ width: "180px", textAlign: "left" }} className="font-semibold text-kumo-default truncate" title={name}>{name}</Table.Cell>
                          <Table.Cell style={{ width: "120px", textAlign: "left" }}>
                            <Badge variant="primary">{type}</Badge>
                          </Table.Cell>
                          <Table.Cell style={{ textAlign: "left" }} className="truncate font-mono text-xs">
                            {paramsText || "—"}
                          </Table.Cell>
                          <Table.Cell style={{ width: "160px", textAlign: "right" }}>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openEditRemote(name, type, remote)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary-destructive"
                                onClick={() => deleteRemote(name)}
                              >
                                删除
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })
                  )}
                </Table.Body>
              </Table>
            </LayerCard>
          </div>
        )}

        {/* 3. Tasks Tab */}
        {activeTab === "tasks" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <Text variant="heading2" as="h2">后台数据传输任务</Text>
                <Text variant="secondary">
                  启动 rclone copy/sync/move 批量传输任务，并实时查看每个任务的状态和百分比。
                </Text>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={fetchTasks}>
                  <ArrowClockwise size={16} />
                  刷新
                </Button>
                <Button variant="primary" onClick={openNewTaskModal}>
                  <Play size={16} />
                  新建传输任务
                </Button>
              </div>
            </div>

            {/* Task list table */}
            <LayerCard className="p-0 overflow-hidden border border-kumo-line rounded-lg">
              <Table className="w-full" style={{ tableLayout: "fixed" }}>
                <Table.Header>
                  <Table.Row>
                    <Table.Head style={{ width: "12%", textAlign: "center" }}>任务 ID</Table.Head>
                    <Table.Head style={{ width: "6%", textAlign: "center" }}>命令</Table.Head>
                    <Table.Head style={{ width: "28%", textAlign: "center" }}>源目录 &rarr; 目标目录</Table.Head>
                    <Table.Head style={{ width: "8%", textAlign: "center" }}>传输状态</Table.Head>
                    <Table.Head style={{ width: "18%", textAlign: "center" }}>进度</Table.Head>
                    <Table.Head style={{ width: "12%", textAlign: "center" }}>传输速率</Table.Head>
                    <Table.Head style={{ width: "16%", textAlign: "center" }}>操作</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {tasks.length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={7} className="text-center py-8 text-kumo-subtle">
                        当前暂无任何传输任务历史。您可以点击右上角“新建传输任务”。
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    tasks.map((task) => {
                      let statusBadge = <Badge variant="secondary">{task.status}</Badge>;
                      if (task.status === "running") {
                        statusBadge = <Badge variant="info">运行中</Badge>;
                      } else if (task.status === "success") {
                        statusBadge = <Badge variant="success">成功</Badge>;
                      } else if (task.status === "failed") {
                        statusBadge = <Badge variant="error">失败</Badge>;
                      } else if (task.status === "stopped") {
                        statusBadge = <Badge variant="warning">已停止</Badge>;
                      }

                      return (
                        <Table.Row key={task.id}>
                          <Table.Cell style={{ width: "12%", textAlign: "center" }} className="font-mono text-xs text-kumo-default truncate" title={task.id}>{task.id}</Table.Cell>
                          <Table.Cell style={{ width: "6%", textAlign: "center" }}>
                            <Badge variant="outline">{task.command.toUpperCase()}</Badge>
                          </Table.Cell>
                          <Table.Cell style={{ width: "28%", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${task.source} → ${task.destination}`}>
                            <div className="font-mono text-xs text-kumo-default flex items-center justify-center gap-1" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span className="font-semibold">{task.source}</span>
                              <span className="text-kumo-subtle">&rarr;</span>
                              <span className="text-kumo-subtle">{task.destination}</span>
                            </div>
                          </Table.Cell>
                          <Table.Cell style={{ width: "8%", textAlign: "center" }}>{statusBadge}</Table.Cell>
                          <Table.Cell style={{ width: "18%", textAlign: "center" }}>
                            {task.status === "running" ? (
                              <div className="flex flex-col gap-1 w-full">
                                <Meter
                                  label={task.bytesTransferred || task.transferred || "准备传输..."}
                                  value={task.progress}
                                  showValue={true}
                                />
                                <div className="flex justify-between items-center text-xs text-kumo-subtle font-mono">
                                  <span>文件: {task.filesTransferred || "--"}</span>
                                  {(task.activeThreads ?? 0) > 0 && <span>线程: {task.activeThreads}</span>}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 items-center">
                                <div className="font-mono text-xs text-kumo-subtle">
                                  进度: {task.progress}%
                                </div>
                                {task.filesTransferred && (
                                  <div className="text-xs text-kumo-subtle mt-0.5">
                                    文件: {task.filesTransferred}
                                  </div>
                                )}
                              </div>
                            )}
                          </Table.Cell>
                          <Table.Cell style={{ width: "12%", textAlign: "center" }}>
                            {task.status === "running" ? (
                              <div className="flex flex-col gap-0.5 font-mono text-xs text-kumo-default items-center">
                                <span className="font-semibold">{task.speed || "--"}</span>
                                <span className="text-kumo-subtle">ETA: {task.eta || "--"}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-0.5 font-mono text-xs text-kumo-subtle items-center">
                                {task.bytesTransferred && (
                                  <div>总量: {task.bytesTransferred}</div>
                                )}
                                {task.endTime && (
                                  <div className="mt-0.5">
                                    耗时: {
                                      Math.round(
                                        (new Date(task.endTime).getTime() - new Date(task.startTime).getTime()) / 1000
                                      )
                                    } 秒
                                  </div>
                                )}
                              </div>
                            )}
                          </Table.Cell>
                          <Table.Cell style={{ width: "16%", textAlign: "center" }}>
                            <div className="flex justify-center gap-1.5 flex-wrap">
                              <Button size="sm" variant="secondary" onClick={() => viewTaskLogs(task)}>
                                <Eye size={16} />
                                日志
                              </Button>
                              {task.status === "running" ? (
                                <Button
                                  size="sm"
                                  variant="secondary-destructive"
                                  onClick={() => stopTask(task.id)}
                                >
                                  <Stop size={16} />
                                  停止
                                </Button>
                              ) : (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => openEditTaskModal(task)}>
                                    编辑
                                  </Button>
                                  <Button size="sm" variant="primary" onClick={() => restartTask(task.id)}>
                                    重启
                                  </Button>
                                </>
                              )}
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })
                  )}
                </Table.Body>
              </Table>
            </LayerCard>
          </div>
        )}

        {/* 4. Rclone Binary Management Tab */}
        {activeTab === "rclone_bin" && (
          <div className="flex flex-col gap-4">
            <div>
              <Text variant="heading2" as="h2">Rclone 主程序管理</Text>
              <Text variant="secondary">
                查看、下载或更新后台调用的 rclone 可执行程序核心文件。
              </Text>
            </div>

            <Grid variant="2-1" gap="base">
              <GridItem>
                <LayerCard className="p-6 flex flex-col gap-4 border border-kumo-line rounded-lg">
                  <Text variant="heading3" as="h3">状态与操作</Text>

                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between border-b border-kumo-line pb-2">
                      <Text variant="secondary">当前可用路径</Text>
                      <Text variant="body" size="sm" as="code">backend/bin/rclone(.exe)</Text>
                    </div>
                    <div className="flex justify-between border-b border-kumo-line pb-2">
                      <Text variant="secondary">当前检测到的版本</Text>
                      <Text variant="body" size="sm" bold as="code">{rcloneVersion}</Text>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="gap-2"
                      onClick={triggerDownload}
                      disabled={downloadStatus.includes("下载") || downloadStatus.includes("解压") || downloadStatus.includes("内存") || downloadStatus.includes("上传")}
                    >
                      <Download size={16} />
                      {rcloneVersion === "Not Installed" ? "下载并安装 Rclone" : "检查并更新至最新版"}
                    </Button>

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      style={{ display: "none" }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      手动上传 Rclone 二进制
                    </Button>
                  </div>
                </LayerCard>
              </GridItem>

              <GridItem>
                <LayerCard className="p-6 flex flex-col gap-4 border border-kumo-line rounded-lg">
                  <Text variant="heading3" as="h3">下载/更新实时日志</Text>
                  <div className="bg-kumo-base border border-kumo-line rounded-lg p-4 h-36 overflow-y-auto font-mono text-xs text-kumo-default">
                    {downloadStatus ? (
                      <div className="flex flex-col gap-1">
                        <Text variant="body" size="xs" as="code">&gt; {downloadStatus}</Text>
                        {(downloadStatus.includes("Downloading") || downloadStatus.includes("extract")) && (
                          <div className="mt-2">
                            <Loader size="sm" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <Text variant="secondary" size="xs" as="code">暂无下载活动任务日志。</Text>
                    )}
                  </div>
                </LayerCard>
              </GridItem>
            </Grid>
          </div>
        )}
      </main>

      {/* MODALS SECTION */}

      {/* 1. New/Edit Remote Modal */}
      {isRemoteModalOpen && (
        <Dialog.Root open={isRemoteModalOpen} onOpenChange={setIsRemoteModalOpen}>
          <Dialog className="p-8 max-w-lg w-full">
            <div className="mb-4 flex items-start justify-between gap-4">
              <Dialog.Title className="text-xl font-bold text-kumo-default">
                {editingRemoteName ? "编辑远程存储" : "新建远程存储"}
              </Dialog.Title>
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="ghost" shape="square" icon={<X />} aria-label="Close" />
                )}
              />
            </div>

            <Dialog.Description className="mb-4 text-kumo-subtle text-sm">
              创建或修改远程存储端的参数配置。连接所需参数因云厂商类型而异。
            </Dialog.Description>

            <div className="flex flex-col gap-3 mt-2">
              <Input
                label="存储源名称"
                size="sm"
                value={remoteNameInput}
                onChange={(e) => setRemoteNameInput(e.target.value)}
                placeholder="例如: gd-drive"
                disabled={!!editingRemoteName}
              />

              <Select
                label="存储源类型"
                size="sm"
                value={remoteTypeInput}
                onValueChange={(val) => setRemoteTypeInput(val as string)}
                className="w-full"
              >
                <Select.Option value="sftp">SFTP 连接</Select.Option>
                <Select.Option value="ftp">FTP 连接</Select.Option>
                <Select.Option value="drive">谷歌云端硬盘 (Google Drive)</Select.Option>
                <Select.Option value="onedrive">微软 OneDrive 网盘</Select.Option>
                <Select.Option value="s3">S3 或兼容对象存储</Select.Option>
                <Select.Option value="webdav">WebDAV 协议</Select.Option>
                <Select.Option value="local">本地文件系统</Select.Option>
                <Select.Option value="dropbox">Dropbox 网盘</Select.Option>
              </Select>

              {/* Params list heading */}
              <div className="mt-2 border-t border-kumo-line pt-4">
                <div className="flex justify-between items-center mb-2">
                  <Text variant="secondary" size="sm" bold>连接参数配置</Text>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRemoteParams([...remoteParams, { key: "", val: "" }])}
                  >
                    添加自定义行
                  </Button>
                </div>

                {/* Key value rows */}
                <div className="max-h-48 overflow-y-auto flex flex-col gap-2 p-1 border border-kumo-line rounded-lg bg-kumo-base">
                  {remoteParams.length === 0 ? (
                    <div className="text-center py-4 text-xs text-kumo-subtle">
                      请点击右上角添加存储所需的参数行。
                    </div>
                  ) : (
                    remoteParams.map((p, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <Input
                          placeholder="配置键 (例如 host)"
                          size="sm"
                          value={p.key}
                          onChange={(e) => {
                            const newP = [...remoteParams];
                            newP[idx].key = e.target.value;
                            setRemoteParams(newP);
                          }}
                          className="flex-1 font-mono text-xs"
                        />
                        <Input
                          placeholder="配置值 (例如 192.168.1.1)"
                          size="sm"
                          value={p.val}
                          onChange={(e) => {
                            const newP = [...remoteParams];
                            newP[idx].val = e.target.value;
                            setRemoteParams(newP);
                          }}
                          className="flex-1 font-mono text-xs"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoteParams(remoteParams.filter((_, i) => i !== idx))}
                          icon={<Trash size={14} />}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="secondary">
                    取消
                  </Button>
                )}
              />
              <Button variant="primary" onClick={saveRemote}>
                保存配置
              </Button>
            </div>
          </Dialog>
        </Dialog.Root>
      )}

      {/* 2. New/Edit Task Modal */}
      {isTaskModalOpen && (
        <Dialog.Root open={isTaskModalOpen} onOpenChange={(open) => {
          setIsTaskModalOpen(open);
          if (!open) setEditingTaskId(null);
        }}>
          <Dialog className="p-8 max-w-lg w-full">
            <div className="mb-4 flex items-start justify-between gap-4">
              <Dialog.Title className="text-xl font-bold text-kumo-default">
                {editingTaskId ? "修改任务配置" : "启动新传输任务"}
              </Dialog.Title>
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="ghost" shape="square" icon={<X />} aria-label="Close" />
                )}
              />
            </div>

            <Dialog.Description className="mb-4 text-kumo-subtle text-sm">
              {editingTaskId ? "修改当前任务配置参数，保存并重新发起该传输任务。" : "创建后台 rclone 命令任务。系统将自动添加 -P 参数以实时显示进度。"}
            </Dialog.Description>

            <div className="flex flex-col gap-4 mt-2">
              <Select
                label="任务操作命令 (Command)"
                size="sm"
                value={taskCommand}
                onValueChange={(val) => setTaskCommand(val as string)}
                className="w-full"
              >
                <Select.Option value="copy">Copy (复制 - 跳过目标已存在文件)</Select.Option>
                <Select.Option value="sync">Sync (同步 - 强一致，目标多余文件会被删除)</Select.Option>
                <Select.Option value="move">Move (移动 - 传输完成后删除源文件)</Select.Option>
              </Select>

              <Input
                label="源路径 (Source Path)"
                size="sm"
                value={taskSource}
                onChange={(e) => setTaskSource(e.target.value)}
                placeholder="例如: gd-drive:/backup 或 D:\files"
              />

              <Input
                label="目标路径 (Destination Path)"
                size="sm"
                value={taskDest}
                onChange={(e) => setTaskDest(e.target.value)}
                placeholder="例如: gd-drive:/backup_destination 或 E:\target"
              />

              <Input
                label="自定义命令行参数 (例如 --dry-run)"
                size="sm"
                value={taskFlags}
                onChange={(e) => setTaskFlags(e.target.value)}
                placeholder="例如: --transfers=4 --ignore-existing --exclude *.tmp"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="secondary">
                    取消
                  </Button>
                )}
              />
              <Button variant="primary" onClick={launchTask}>
                {editingTaskId ? "保存并启动" : "启动任务"}
              </Button>
            </div>
          </Dialog>
        </Dialog.Root>
      )}

      {/* 3. Real-Time Task Logs Modal */}
      {isLogsModalOpen && selectedTask && (
        <Dialog.Root open={isLogsModalOpen} onOpenChange={setIsLogsModalOpen}>
          <Dialog className="p-8 max-w-5xl w-full">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-bold text-kumo-default">
                  任务实时日志
                </Dialog.Title>
                <Dialog.Description className="text-xs text-kumo-subtle mt-0.5">
                  ID: {selectedTask.id} | 命令: {selectedTask.command === "copy" ? "复制" : selectedTask.command === "sync" ? "同步" : "移动"} | 状态:{" "}
                  {selectedTask.status === "running" ? "运行中" : selectedTask.status === "success" ? "成功" : selectedTask.status === "failed" ? "失败" : "已停止"}
                </Dialog.Description>
              </div>
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="ghost" shape="square" icon={<X />} aria-label="Close" />
                )}
              />
            </div>

            <div
              className="mt-4 border border-kumo-line rounded-lg overflow-auto scroll-smooth"
              style={{ backgroundColor: "#0d1117", height: "420px" }}
            >
              <pre
                style={{
                  margin: 0,
                  padding: "16px",
                  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                  fontSize: "12px",
                  lineHeight: "1.6",
                  color: "#e6edf3",
                  whiteSpace: "pre",
                  overflowWrap: "normal",
                  wordBreak: "normal",
                  minWidth: "max-content",
                }}
              >
                {selectedTask.logs || "等待输出日志..."}
              </pre>
              <div ref={logEndRef} />
            </div>

            <div className="mt-6 flex justify-between items-center">
              <div>
                {selectedTask.status === "running" ? (
                  <span className="flex items-center gap-2 text-xs text-kumo-info">
                    <Loader size="sm" />
                    正在监听实时输出，并自动滚动到底部...
                  </span>
                ) : (
                  <span className="text-xs text-kumo-success flex items-center gap-1">
                    <CheckCircle size={14} />
                    日志已结束输出。
                  </span>
                )}
              </div>
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="secondary">
                    关闭
                  </Button>
                )}
              />
            </div>
          </Dialog>
        </Dialog.Root>
      )}
    </div>
  );
}
