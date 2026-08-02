# Changelog

## [0.4.0] - 2026-08-02

### Changed

- 图片压缩、文件重命名、Excel 合并、HTTP 检测、Git 巡检和 JSON 格式化全部迁移到 Rust 原生实现。
- 应用自带工具不再依赖 Python、Pillow、openpyxl、Node.js、PowerShell 脚本或 Git 命令行。
- 外部 Python、Node.js、PowerShell、Shell 和可执行文件运行时仅用于用户导入的自定义工具。
- 安装包不再携带 `.py`、`.mjs` 和 `.ps1` 内置脚本资源。

### Added

- 原生内置任务注册表和取消机制。
- 基于 `image` 的图片重新编码。
- 基于 `calamine` 与 `rust_xlsxwriter` 的 Excel 读取和流式写入。
- 基于 `reqwest` 的并发 HTTP 检测。
- 基于 `libgit2` 的 Git 工作区与分支巡检。
- 原生工具参数、CSV、JSON 和路径处理单元测试。

### Fixed

- 文件批量重命名在失败或取消时执行回滚。
- Excel 数据行的来源文件列固定写入表头之后，避免短行造成列错位。
- HTTP 请求在任务取消后主动停止等待。

## [0.3.0] - 2026-08-02

### Added

- Tauri 2 桌面外壳与 Windows、macOS、Linux 打包配置。
- Rust 进程执行层，支持 Python、Node.js、PowerShell、Shell 与可执行文件。
- stdout、stderr、结构化进度、输出产物、超时和任务取消。
- 原生文件与目录选择器。
- 图片压缩、文件重命名、Excel 合并、HTTP 检测和 Git 巡检内置工具。
- 工具清单执行协议、参数模板、环境变量和运行时探测。
- 跨平台 Rust/Tauri CI、内置工具集成测试和依赖锁文件。

### Fixed

- 原生路径选择不再依赖中文标签判断文件或目录类型。
- 旧版 LocalStorage 中的内置工具会自动升级，同时保留自定义工具。
- 图片压缩拒绝将输出目录放在输入目录内部，避免递归重复处理。
- Excel 合并会检查表头一致性并正确关闭工作簿。
- 移除 Git 巡检中未实现的依赖更新选项。

### Security

- 进程以程序路径和参数数组启动，不拼接任意 Shell 命令字符串。
- 相对入口路径禁止包含 `..`，运行时入口扩展名会被校验。
- 单任务最长运行时间限制为 24 小时。
