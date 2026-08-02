# Tools Deck

一个用于整理、检索、配置和运行个人脚本的桌面工具库应用。

Tools Deck 将零散的 Python、Node.js、PowerShell、Shell 脚本和可执行程序抽象成统一的“工具”，通过参数表单、参数预设、任务队列、实时日志和运行历史降低重复使用成本。

## 当前版本

当前版本为 **v0.3.0**，已经接入 **Tauri 2 桌面外壳和 Rust 进程执行层**。

### 桌面端已实现

- React 19 + Vite 8 桌面界面
- Tauri 2 原生窗口与跨平台安装包配置
- Rust 结构化进程执行器
- Python、Node.js、PowerShell、Shell 和可执行文件运行
- 原生文件与目录选择器
- stdout、stderr 实时日志
- 脚本结构化进度事件
- 输出文件和目录产物
- 任务取消与最长运行时间控制
- Python、Node.js、PowerShell、Shell 环境探测
- 参数模板、参数数组展开、工作目录和环境变量
- 相对资源入口与绝对本地入口
- 多工具任务队列顺序执行
- 参数预设和运行历史

### 内置真实工具

- 图片批量压缩：Python + Pillow
- 文件批量重命名：Node.js
- Excel 批量合并：Python + openpyxl
- HTTP 批量检测：Python 标准库
- Git 仓库巡检：PowerShell + Git
- JSON 格式化与校验：内置 Web 运行时

普通浏览器版本仍可以运行 JSON 内置工具；需要本地进程的工具会使用明确标识的预览模式。启动 Tauri 桌面端后，脚本才会在 Rust 进程层中真实执行。

## 技术栈

- React 19
- Vite 8
- Tauri 2
- Rust 2021
- Tokio Process
- Tauri IPC Channel
- Tauri Dialog Plugin
- LocalStorage
- Node.js Test Runner

## 环境准备

基础环境：

- Node.js `20.19+` 或 `22.12+`
- Rust stable
- 对应操作系统的 Tauri 编译依赖

工具运行环境按需安装：

```bash
# Python 图片压缩
python -m pip install Pillow

# Python Excel 合并
python -m pip install openpyxl
```

Node 工具需要 `node` 可执行文件；Git 巡检需要 Git 和 PowerShell。Windows 会探测 `pwsh` 与系统自带的 `powershell.exe`，macOS/Linux 需要 PowerShell 7 的 `pwsh`。

## 启动方式

安装前端依赖：

```bash
npm install
```

启动 Web 预览：

```bash
npm run dev
```

启动 Tauri 桌面开发模式：

```bash
npm run desktop:dev
```

运行检查：

```bash
npm run check
npm test
npm run desktop:check
```

构建当前系统的桌面安装包：

```bash
npm run desktop:build
```

构建产物位于：

```text
src-tauri/target/release/bundle/
```

仓库提供 `Desktop Build` GitHub Actions 工作流，可以手动构建 Windows、macOS 和 Linux 安装包；推送 `v*` 标签时也会触发跨平台构建。

## 项目结构

```text
src/
├── components/          # 通用界面组件
├── data/                # 内置工具定义与执行入口
├── domain/              # 工具清单校验与序列化
├── hooks/               # 本地持久化 Hooks
├── runtime/             # Web/Tauri 运行时和原生路径选择
├── App.jsx              # 主应用、队列、预设与历史逻辑
├── styles.css
└── enhancements.css

src-tauri/
├── capabilities/        # Tauri 权限能力
├── src/
│   ├── execution.rs     # 进程管理、运行时探测、日志和取消
│   ├── models.rs        # IPC 数据协议
│   ├── lib.rs
│   └── main.rs
├── Cargo.toml
└── tauri.conf.json

tools/builtin/
├── image-compressor.py
├── batch-renamer.mjs
├── excel-merger.py
├── http-batch-check.py
└── git-repo-audit.ps1
```

## 桌面执行协议

工具通过 `runtime` 和 `execution` 描述运行方式：

```json
{
  "id": "my-python-tool",
  "name": "我的 Python 工具",
  "category": "developer",
  "runtime": {
    "type": "python",
    "label": "Python 3"
  },
  "execution": {
    "entry": "D:/Scripts/tool.py",
    "args": ["--input", "{{input}}"],
    "cwd": "D:/Scripts",
    "env": {
      "RUN_MODE": "safe"
    },
    "timeoutSeconds": 1800
  },
  "parameters": [
    {
      "key": "input",
      "label": "输入目录",
      "type": "directory",
      "required": true
    }
  ]
}
```

完整字段和脚本事件格式见 [工具定义规范](docs/tool-manifest.md)。

## 进程安全边界

- 前端不能提交完整 Shell 命令字符串
- Rust 使用程序路径和参数数组直接创建进程
- Python、Node 和 PowerShell 使用固定解释器入口
- 入口扩展名必须与运行时匹配
- 相对入口路径禁止使用 `..`
- 环境变量名称会经过校验
- 默认超时 1 小时，最大 24 小时
- 运行中的进程可以被取消
- Windows 后台执行不创建额外控制台窗口

需要注意：外部工具脚本与 Tools Deck 使用相同的当前用户权限。导入和运行第三方工具前，应检查代码来源和工具清单。

## 数据存储

当前版本将以下内容保存在应用 WebView 的 LocalStorage：

- 自定义工具
- 收藏列表
- 参数预设
- 任务队列
- 最近 100 条运行记录
- 主题设置

后续版本将迁移到 SQLite，并使用系统密钥库保存 Token、Cookie 和密码。

## 后续路线

1. 增加桌面设置中心和运行时健康检查界面
2. 使用 `uv` 为每个 Python 工具管理独立环境
3. 扫描本地 `tools/` 目录并自动加载工具包
4. 增加输出文件打开、定位和历史产物管理
5. 增加工具包哈希、签名和首次运行授权
6. 将持久化迁移到 SQLite 和系统密钥库
7. 增加并发队列、失败策略和工作流编排

## License

[MIT](LICENSE)
