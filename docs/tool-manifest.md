# 工具定义规范

工具定义是 Tools Deck 的核心协议。每个工具需要拥有稳定且唯一的 `id`，并通过参数清单描述前端表单。

## 基础字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定、唯一、使用短横线的工具标识 |
| `name` | 是 | 工具名称 |
| `description` | 否 | 一句话用途说明 |
| `category` | 是 | `file`、`image`、`data`、`network`、`developer` |
| `runtime` | 否 | 运行环境说明 |
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

参数需要通过独立参数数组传递给桌面运行层，不应将用户输入直接插入完整 Shell 命令字符串。

## 计划中的桌面清单

桌面版将进一步支持：

```json
{
  "entry": "main.py",
  "runtime": {
    "type": "python",
    "version": ">=3.11",
    "runner": "uv"
  },
  "permissions": {
    "filesystem": {
      "read": ["user-selected"],
      "write": ["user-selected"]
    },
    "network": false
  },
  "execution": {
    "timeout": 3600,
    "allowConcurrent": false
  }
}
```

运行层必须校验入口文件、权限、参数类型和路径边界。
