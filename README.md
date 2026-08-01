# Tools Deck

一个用于整理、检索、配置和运行个人脚本的工具库应用。

Tools Deck 将零散的 Python、Node.js、PowerShell、Shell 脚本抽象成统一的“工具”，通过参数表单、运行日志、历史记录和工具清单降低重复使用成本。

## 当前版本

当前仓库包含 **React Web MVP（v0.1.0）**，已实现：

- 工具分类、搜索、收藏与最近使用
- 工具详情与动态参数表单
- 运行进度、实时日志和取消操作
- 运行历史与再次运行
- JSON 工具定义导入
- 本地数据持久化
- 明暗主题与响应式布局
- 独立 Runtime Adapter，便于后续接入 Tauri 桌面执行层

> 浏览器无法直接启动本地 Python 或 Shell 进程，因此 Web 版本使用预览运行时模拟执行流程。真正的本地脚本执行、环境管理和权限控制将在 Tauri 桌面层完成，前端不直接拼接系统命令。

## 技术栈

- React 19
- Vite 8
- 原生 CSS Variables
- LocalStorage 持久化
- 无 UI 组件库与图标库依赖

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

Vite 8 要求 Node.js `20.19+` 或 `22.12+`。

## 项目结构

```text
src/
├── components/        # 通用界面组件
├── data/              # 内置工具定义与分类
├── hooks/             # 本地持久化等 Hooks
├── runtime/           # 运行时适配层
├── App.jsx            # 主应用与交互逻辑
└── styles.css         # 完整设计系统与响应式样式
```

## 工具定义

当前 MVP 使用 JSON 对工具进行描述：

```json
{
  "id": "image-compressor",
  "name": "图片批量压缩",
  "description": "批量压缩图片并保留目录结构",
  "category": "image",
  "runtime": {
    "type": "python",
    "label": "Python 3.12",
    "status": "ready"
  },
  "parameters": [
    {
      "key": "input",
      "label": "输入文件夹",
      "type": "directory",
      "required": true
    },
    {
      "key": "quality",
      "label": "图片质量",
      "type": "range",
      "min": 30,
      "max": 100,
      "default": 82
    }
  ]
}
```

支持的参数类型包括：

- `text`
- `number`
- `boolean`
- `range`
- `textarea`
- `select`
- `directory`
- `files`

完整设计见 [工具定义规范](docs/tool-manifest.md)。

## 后续路线

1. 接入 Tauri 2 桌面外壳
2. 建立 Rust 进程管理与权限校验层
3. 扫描本地 `tools/` 目录并加载清单
4. 接入 Python `uv`、Node.js、PowerShell 和可执行文件运行器
5. 增加结构化进度事件与输出产物协议
6. 增加参数预设、批量队列和工作流编排
7. 增加工具导入、导出、Git 更新与签名校验

## 安全原则

- 前端不直接执行任意系统命令
- 程序与参数分开传递，避免命令拼接
- Token、Cookie 和密码不写入工具清单或运行日志
- 外部工具首次导入时展示权限和来源
- 工具运行应限制超时、并发、可访问目录和网络范围

## License

[MIT](LICENSE)
