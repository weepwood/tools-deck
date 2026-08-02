use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeKind {
    Python,
    Node,
    Powershell,
    Shell,
    Executable,
    Http,
    Builtin,
    Custom,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDefinition {
    #[serde(rename = "type")]
    pub kind: RuntimeKind,
    #[allow(dead_code)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecutionDefinition {
    pub entry: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    pub timeout_seconds: Option<u64>,
    pub argument_string_param: Option<String>,
    pub allow_non_zero_exit: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRunRequest {
    pub run_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub runtime: RuntimeDefinition,
    pub execution: ExecutionDefinition,
    pub params: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub run_id: String,
    pub status: String,
    pub duration: u128,
    pub summary: String,
    pub exit_code: Option<i32>,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunEvent {
    Started {
        run_id: String,
        message: String,
        pid: Option<u32>,
    },
    Output {
        run_id: String,
        stream: String,
        line: String,
        progress: Option<u8>,
    },
    Progress {
        run_id: String,
        progress: u8,
        message: String,
        level: String,
    },
    Artifact {
        run_id: String,
        artifact: Artifact,
        progress: Option<u8>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub runtime: RuntimeKind,
    pub available: bool,
    pub command: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScriptEvent {
    Progress {
        progress: u8,
        message: String,
        #[serde(default = "default_level")]
        level: String,
    },
    Artifact {
        artifact: Artifact,
        #[serde(default)]
        progress: Option<u8>,
    },
}

fn default_level() -> String {
    "info".to_string()
}
