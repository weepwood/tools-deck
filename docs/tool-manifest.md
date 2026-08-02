# 工具定义规范

工具定义是 Tools Deck 的核心协议。每个工具需要拥有稳定且唯一的 `id`，并通过参数清单描述前端表单和桌面执行方式。

## 基础字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定、唯一、使用小写字母、数字和短横线的工具标识 |
| `name` | 是 | 工具名称 |
| `description` | 否 | 一句话用途说明 |
| `category` | 是 | `file`、`image`、`data`、`network`、`developer` |
| `runtime` | 进程工具必填 | `python`、`node`、`powershell`、`shell`、`executable`、`builtin` 等 |
| `execution` | 进程工具必填 | 程序入口、参数、工作目录、环境变量和超时 |
| `parameters` | 是 | 参数数组 |
| `tags` | 否 | 搜索标签 |
| `output` | 否 | 输出产物定义 |

## 参数字段

```json
{
  "key": "input",
  "label": "输入文件夹",
  "type": "directory",
  "required": true,
  "placeholder": "选择需要处理的目录"
}
```

支持的参数类型：

- `text`
- `number`
- `boolean`
- `range`
- `textarea`
- `select`
- `directory`
- `files`

## Python 工具示例

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
    "entry": "D:/Scripts/my-tool/main.py",
    "args": [
      "--input",
      "{{input}}",
      "--count={{count}}"
    ],
    "cwd": "D:/Scripts/my-tool",
    "env": {
      "RUN_MODE": "{{mode}}"
    },
    "timeoutSeconds": 1800
  },
  "parameters": [
    {
      "key": "input",
      "label": "输入文件夹",
      "type": "directory",
      "required": true
    },
    {
      "key": "count",
      "label": "处理数量",
      "type": "number",
      "default": 10
    },
    {
      "key": "mode",
      "label": "模式",
      "type": "select",
      "options": ["safe", "fast"],
      "default": "safe"
    }
  ]
}
```

## 可执行程序示例

```json
{
  "id": "local-converter",
  "name": "本地转换器",
  "category": "file",
  "runtime": {
    "type": "executable",
    "label": "本地程序"
  },
  "execution": {
    "entry": "C:/Tools/converter.exe",
    "args": ["--source", "{{source}}", "--output", "{{output}}"],
    "argumentStringParam": "extraArguments",
    "timeoutSeconds": 3600
  },
  "parameters": [
    { "key": "source", "label": "源目录", "type": "directory", "required": true },
    { "key": "output", "label": "输出目录", "type": "directory", "required": true },
    { "key": "extraArguments", "label": "附加参数", "type": "text" }
  ]
}
```

## `execution` 字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `entry` | 无 | 脚本或可执行文件路径；相对路径从应用资源目录解析 |
| `args` | `[]` | 参数模板数组；不会拼接成 Shell 命令 |
| `cwd` | 入口文件目录 | 工作目录，可使用 `{{parameter}}` 模板 |
| `env` | `{}` | 额外环境变量，可使用参数模板 |
| `timeoutSeconds` | `3600` | 运行超时，范围 1—86400 秒 |
| `argumentStringParam` | 无 | 将某个文本参数按命令行参数规则拆分后附加 |
| `allowNonZeroExit` | `false` | 是否允许非零退出码被视为成功 |

当参数模板是完整的 `{{files}}`，并且参数值为数组时，运行层会展开为多个独立参数。

## 脚本与界面通信

脚本可以向标准输出发送结构化事件：

```text
::tools-deck::{"type":"progress","progress":42,"message":"正在处理文件"}
```

输出产物：

```text
::tools-deck::{"type":"artifact","progress":100,"artifact":{"type":"file","label":"处理结果","path":"D:/Output/result.xlsx"}}
```

普通 stdout 和 stderr 会原样显示在执行日志中。

## 运行环境

- Python：Windows 依次探测 `py -3`、`python`、`python3`；macOS/Linux 探测 `python3`、`python`
- Node.js：探测 `node`
- PowerShell：Windows 探测 `pwsh` 和 `powershell.exe`；macOS/Linux 探测 `pwsh`
- Shell：Windows 支持 `.cmd`、`.bat`；macOS/Linux 支持 `.sh`、`.bash`、`.zsh`
- Executable：直接启动指定文件

Tools Deck 不会自动安装解释器或脚本依赖。Python 工具使用 Pillow、openpyxl 等第三方库时，需要在当前 Python 环境中安装相应依赖。

## 安全规则

- 程序和参数始终分开传递，不执行拼接后的 Shell 命令字符串
- 相对入口路径不允许包含 `..`
- 入口扩展名必须与运行时匹配
- 环境变量名称需要通过格式校验
- 单个任务最长运行 24 小时
- 用户可以取消任务，Rust 进程层会终止子进程
- 导入外部工具前应确认脚本来源；工具代码拥有与当前用户相同的文件访问权限
