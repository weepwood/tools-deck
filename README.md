# Tools Deck

一个用于整理、检索、配置和运行个人工具与脚本的桌面工作台。

Tools Deck 将常用能力分为两类：应用自带工具由 Rust 原生实现，开箱即用；用户自己的 Python、Node.js、PowerShell、Shell 脚本和可执行程序，通过统一工具清单接入。

## 当前版本

当前版本为 **v0.5.0**，桌面端基于 **Tauri 2 + React + Rust**。

## 工作台界面

v0.5.0 将工具发现与工具执行拆分为清晰的桌面信息架构：

- 首页：正在运行、继续上次任务、收藏和最近使用。
- 工具库：搜索、分类以及网格或列表浏览。
- 工具工作区：全宽参数配置、运行结果、日志和产物。
- 任务：顺序队列、进度、重试和清理。
- 历史：恢复最近 100 次运行使用的参数。
- 设置：主题、侧栏和运行时信息。
- `Ctrl/Cmd + K`：全局工具与命令面板。

文件批处理工具采用步骤式界面；HTTP 检测和 Git 巡检拥有统计摘要与明细结果；桌面产物支持打开、定位和复制路径。

## 原生内置工具

以下工具直接编译进桌面应用，不需要安装 Python、Node.js、PowerShell、Git 命令行或第三方脚本依赖：

- 图片批量压缩：Rust `image`
- 文件批量重命名：Rust 标准文件系统
- Excel 批量合并：`calamine` + `rust_xlsxwriter`
- HTTP 批量检测：异步 `reqwest`
- Git 仓库巡检：`libgit2`
- JSON 格式化与校验：`serde_json`

## 自定义外部工具

用户导入的工具仍可使用：

- Python
- Node.js
- PowerShell
- Windows CMD / Unix Shell
- 独立可执行文件

外部运行时只用于用户自定义工具，不承载应用自带功能。

## 主要能力

- React 19 + Vite 8 界面
- Tauri 2 原生窗口
- Rust 原生工具执行层
- Rust 外部进程执行层
- 原生文件和目录选择器
- stdout、stderr 与结构化进度
- 任务取消与超时控制
- 多工具任务队列
- 参数预设与运行历史
- 产物打开、文件管理器定位和路径复制
- Windows、macOS、Linux 自动化测试
- Windows NSIS/MSI 与 macOS DMG 发布包

## 技术栈

- React 19
- Vite 8
- Tauri 2
- Rust 2021
- Tokio
- Reqwest
- image
- Calamine
- rust_xlsxwriter
- libgit2
- Tauri IPC Channel
- LocalStorage

## 开发环境

- Node.js `20.19+` 或 `22.12+`
- Rust `1.85+`
- 当前操作系统对应的 Tauri 编译依赖

内置工具不需要额外安装 Pillow、openpyxl、Node.js 脚本依赖或 PowerShell 模块。

## 启动

```bash
npm ci
npm run desktop:dev
```

Web 界面预览：

```bash
npm run dev
```

检查与测试：

```bash
npm run check
npm test
npm run desktop:test
npm run desktop:check
```

构建安装包：

```bash
npm run desktop:build
```

产物位于：

```text
src-tauri/target/release/bundle/
```

## 项目结构

```text
src/
├── components/          # 通用组件、工具结果视图
├── data/                # 内置工具定义
├── domain/              # 工具清单与报告解析
├── hooks/               # 本地持久化
├── runtime/             # Web/Tauri 运行时桥接
├── App.jsx
├── styles.css
├── enhancements.css
└── phase2.css

src-tauri/
├── capabilities/
├── src/
│   ├── artifact_runtime.rs # 受控产物打开、定位和读取
│   ├── builtins.rs         # 六个 Rust 原生内置工具
│   ├── builtin_runtime.rs  # 内置任务注册、运行和取消
│   ├── execution.rs        # 自定义外部进程执行器
│   ├── models.rs           # IPC 数据协议
│   ├── lib.rs
│   └── main.rs
├── Cargo.toml
└── tauri.conf.json
```

## 自定义工具协议

外部工具通过 `runtime` 和 `execution` 描述运行方式：

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

完整字段见 [工具定义规范](docs/tool-manifest.md)。

## 安全边界

- 内置工具只执行编译后的 Rust 代码。
- 外部工具以程序路径和参数数组启动，不拼接任意 Shell 命令字符串。
- 入口扩展名必须与运行时匹配，相对入口路径禁止包含 `..`。
- 环境变量名称经过校验。
- 默认超时一小时，最大 24 小时。
- 原生任务和外部进程均可取消。
- 报告读取仅允许 CSV、Markdown、文本、JSON 和日志，单文件不超过 5 MB。

外部工具拥有与当前用户相同的文件访问权限，导入第三方工具前仍需检查来源。

## 数据存储

当前使用 WebView LocalStorage 保存：

- 自定义工具
- 收藏列表
- 参数预设
- 任务队列
- 最近 100 条运行记录
- 主题与界面设置

## 后续路线

1. 增加运行时健康检查和解释器设置中心。
2. 为自定义 Python 工具提供独立 `uv` 环境。
3. 扫描本地工具目录并加载工具包。
4. 增加工具包哈希、签名和首次运行授权。
5. 将持久化迁移到 SQLite 和系统密钥库。
6. 增加并发队列、失败策略和工作流编排。

## License

[MIT](LICENSE)
