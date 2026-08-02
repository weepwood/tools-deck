# Tools Deck

一个用于整理、检索、配置和运行个人脚本的工具库应用。

Tools Deck 将零散的 Python、Node.js、PowerShell、Shell 脚本抽象成统一的“工具”，通过参数表单、参数预设、任务队列、运行日志和历史记录降低重复使用成本。

## 当前版本

当前仓库为 **React Web MVP v0.2.0**。

### 已实现

- 工具分类、搜索、收藏与最近使用
- 工具详情与动态参数表单
- 参数预设的保存、载入和删除
- 多工具任务队列、顺序执行、停止与失败重试
- 运行进度、实时日志和取消操作
- 运行历史保存执行参数，并可重新载入
- JSON 工具定义导入、结构校验与导出
- 输出产物展示与文本结果复制
- LocalStorage 本地持久化
- 明暗主题与响应式布局
- 独立 Runtime Adapter，便于后续接入 Tauri 桌面执行层
- Node.js 原生测试与 GitHub Actions 构建检查

### 可真实运行的内置工具

`JSON 格式化与校验` 已接入真实 Web 运行时，支持：

- JSON 语法校验
- 2 空格、4 空格或 Tab 缩进
- 递归排序对象键名
- 输出结果预览和复制
- 错误日志与运行历史记录

> 浏览器无法直接启动本地 Python、PowerShell 或 Shell 进程。除内置工具外，当前 Web 版本仍使用明确标识的预览运行时。真正的本地脚本执行、环境管理和权限控制将在 Tauri 桌面层完成。

## 技术栈

- React 19
- Vite 8
- 原生 CSS Variables
- LocalStorage 持久化
- Node.js Test Runner
- 无 UI 组件库与图标库依赖

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run check
npm test
npm run build
npm run preview
```

Vite 8 要求 Node.js `20.19+` 或 `22.12+`。

## 项目结构

```text
src/
├── components/        # 通用界面组件
├── data/              # 内置工具定义与分类
├── domain/            # 工具清单校验与序列化
├── hooks/             # 本地持久化 Hooks
├── runtime/           # Web/桌面运行时适配层
├── App.jsx            # 主应用、队列、预设与历史逻辑
├── styles.css         # 基础设计系统
└── enhancements.css   # 队列、预设与结果样式

tests/
├── manifest.test.js
└── runtime.test.js
```

## 工具定义

工具通过 JSON 清单描述：

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

当前支持的参数类型：

- `text`
- `number`
- `boolean`
- `range`
- `textarea`
- `select`
- `directory`
- `files`

导入时会检查：

- 工具 ID 格式与重复冲突
- 分类和运行时类型
- 参数类型与重复参数 key
- select 选项完整性
- 数字参数的 min/max 合法性

完整设计见 [工具定义规范](docs/tool-manifest.md)。

## 数据存储

Web MVP 将以下内容保存到浏览器 LocalStorage：

- 自定义工具
- 收藏列表
- 参数预设
- 任务队列
- 最近 100 条运行记录
- 主题设置

清除浏览器站点数据会同时删除这些本地数据。桌面版本将迁移到 SQLite 和系统密钥库。

## 后续路线

1. 接入 Tauri 2 桌面外壳
2. 建立 Rust 进程管理与权限校验层
3. 扫描本地 `tools/` 目录并加载清单
4. 接入 Python `uv`、Node.js、PowerShell 和可执行文件运行器
5. 增加结构化进度事件和输出产物协议
6. 增加任务并发限制、失败策略和队列持久恢复
7. 增加工具包导入、Git 更新、哈希与签名校验
8. 增加设置/缓存的导入导出和备份

## 安全原则

- 前端不直接执行任意系统命令
- 程序与参数分开传递，避免命令字符串拼接
- Token、Cookie 和密码不写入工具清单或运行日志
- 外部工具首次导入时校验结构、权限和来源
- 工具运行应限制超时、并发、可访问目录和网络范围

## License

[MIT](LICENSE)
