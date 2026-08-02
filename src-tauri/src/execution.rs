use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use serde_json::Value;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::Mutex,
    time::sleep,
};

use crate::models::{
    RunEvent, RunResult, RuntimeKind, RuntimeStatus, ScriptEvent, ToolRunRequest,
};

const STRUCTURED_PREFIX: &str = "::tools-deck::";
const MAX_TIMEOUT_SECONDS: u64 = 24 * 60 * 60;

#[derive(Clone)]
struct RunningProcess {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct ProcessRegistry {
    inner: Mutex<HashMap<String, RunningProcess>>,
}

struct ResolvedCommand {
    program: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    env: HashMap<String, String>,
    timeout: Duration,
}

struct RuntimeCandidate {
    program: String,
    prefix_args: Vec<String>,
    version: String,
}

#[tauri::command]
pub async fn detect_runtimes() -> Vec<RuntimeStatus> {
    vec![
        detect_runtime(RuntimeKind::Python).await,
        detect_runtime(RuntimeKind::Node).await,
        detect_runtime(RuntimeKind::Powershell).await,
        detect_runtime(RuntimeKind::Shell).await,
        RuntimeStatus {
            runtime: RuntimeKind::Executable,
            available: true,
            command: None,
            version: None,
            error: None,
        },
    ]
}

#[tauri::command]
pub async fn cancel_tool(
    run_id: String,
    state: State<'_, ProcessRegistry>,
) -> Result<bool, String> {
    let process = {
        let registry = state.inner.lock().await;
        registry.get(&run_id).cloned()
    };

    let Some(process) = process else {
        return Ok(false);
    };

    process.cancelled.store(true, Ordering::SeqCst);
    let mut child = process.child.lock().await;
    match child.kill().await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => Ok(true),
        Err(error) => Err(format!("停止进程失败：{error}")),
    }
}

#[tauri::command]
pub async fn run_tool(
    app: AppHandle,
    state: State<'_, ProcessRegistry>,
    request: ToolRunRequest,
    on_event: Channel<RunEvent>,
) -> Result<RunResult, String> {
    validate_run_id(&request.run_id)?;

    {
        let registry = state.inner.lock().await;
        if registry.contains_key(&request.run_id) {
            return Err("相同 runId 的任务已经在运行。".to_string());
        }
    }

    let resolved = resolve_command(&app, &request).await?;
    let started = Instant::now();
    let mut command = Command::new(&resolved.program);
    command
        .args(&resolved.args)
        .current_dir(&resolved.cwd)
        .envs(&resolved.env)
        .env(
            "TOOLS_DECK_PARAMS_JSON",
            serde_json::to_string(&request.params)
                .map_err(|error| format!("序列化运行参数失败：{error}"))?,
        )
        .env("TOOLS_DECK_RUN_ID", &request.run_id)
        .env("TOOLS_DECK_TOOL_ID", &request.tool_id)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "无法启动 {}：{}",
            resolved.program.to_string_lossy(),
            error
        )
    })?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let control = RunningProcess {
        child: Arc::new(Mutex::new(child)),
        cancelled: Arc::new(AtomicBool::new(false)),
    };

    {
        let mut registry = state.inner.lock().await;
        registry.insert(request.run_id.clone(), control.clone());
    }

    let _ = on_event.send(RunEvent::Started {
        run_id: request.run_id.clone(),
        message: format!("已启动「{}」", request.tool_name),
        pid,
    });

    let stdout_task = stdout.map(|stream| {
        tokio::spawn(forward_stream(
            BufReader::new(stream),
            request.run_id.clone(),
            "stdout",
            on_event.clone(),
        ))
    });
    let stderr_task = stderr.map(|stream| {
        tokio::spawn(forward_stream(
            BufReader::new(stream),
            request.run_id.clone(),
            "stderr",
            on_event.clone(),
        ))
    });

    let mut timed_out = false;
    let exit_status = loop {
        if started.elapsed() >= resolved.timeout {
            timed_out = true;
            control.cancelled.store(true, Ordering::SeqCst);
            let mut child = control.child.lock().await;
            let _ = child.kill().await;
        }

        let status = {
            let mut child = control.child.lock().await;
            child
                .try_wait()
                .map_err(|error| format!("读取进程状态失败：{error}"))?
        };

        if let Some(status) = status {
            break status;
        }

        sleep(Duration::from_millis(100)).await;
    };

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    {
        let mut registry = state.inner.lock().await;
        registry.remove(&request.run_id);
    }

    let duration = started.elapsed().as_millis();
    let exit_code = exit_status.code();

    if timed_out {
        return Err(format!(
            "任务运行超过 {} 秒，已自动停止。",
            resolved.timeout.as_secs()
        ));
    }

    if control.cancelled.load(Ordering::SeqCst) {
        return Ok(RunResult {
            run_id: request.run_id,
            status: "cancelled".to_string(),
            duration,
            summary: "任务已取消".to_string(),
            exit_code,
            artifacts: Vec::new(),
        });
    }

    if !exit_status.success() && !request.execution.allow_non_zero_exit {
        return Err(format!(
            "进程以非零状态退出：{}",
            exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ));
    }

    Ok(RunResult {
        run_id: request.run_id,
        status: "success".to_string(),
        duration,
        summary: format!("{} 执行完成", request.tool_name),
        exit_code,
        artifacts: Vec::new(),
    })
}

async fn forward_stream<R>(
    reader: R,
    run_id: String,
    stream: &'static str,
    channel: Channel<RunEvent>,
) where
    R: AsyncBufRead + Unpin,
{
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(payload) = line.strip_prefix(STRUCTURED_PREFIX) {
            if let Ok(event) = serde_json::from_str::<ScriptEvent>(payload) {
                match event {
                    ScriptEvent::Progress {
                        progress,
                        message,
                        level,
                    } => {
                        let _ = channel.send(RunEvent::Progress {
                            run_id: run_id.clone(),
                            progress: progress.min(100),
                            message,
                            level,
                        });
                    }
                    ScriptEvent::Artifact { artifact, progress } => {
                        let _ = channel.send(RunEvent::Artifact {
                            run_id: run_id.clone(),
                            artifact,
                            progress: progress.map(|value| value.min(100)),
                        });
                    }
                }
                continue;
            }
        }

        let _ = channel.send(RunEvent::Output {
            run_id: run_id.clone(),
            stream: stream.to_string(),
            line,
            progress: None,
        });
    }
}

async fn resolve_command(
    app: &AppHandle,
    request: &ToolRunRequest,
) -> Result<ResolvedCommand, String> {
    let entry_template = request
        .execution
        .entry
        .as_deref()
        .ok_or_else(|| "execution.entry 不能为空。".to_string())?;
    let entry_value = expand_template(entry_template, &request.params)?;
    let entry = resolve_entry_path(app, &entry_value, &request.runtime.kind)?;
    let mut args = expand_args(&request.execution.args, &request.params)?;

    if let Some(param_key) = request.execution.argument_string_param.as_deref() {
        if let Some(Value::String(value)) = request.params.get(param_key) {
            args.extend(
                shell_words::split(value)
                    .map_err(|error| format!("解析附加参数失败：{error}"))?,
            );
        }
    }

    let (program, mut prefix_args) = match request.runtime.kind {
        RuntimeKind::Python => {
            let candidate = find_python().await?;
            let mut prefix = candidate.prefix_args;
            prefix.push(entry.to_string_lossy().to_string());
            (PathBuf::from(candidate.program), prefix)
        }
        RuntimeKind::Node => {
            ensure_command("node", &["--version"]).await?;
            (
                PathBuf::from("node"),
                vec![entry.to_string_lossy().to_string()],
            )
        }
        RuntimeKind::Powershell => {
            let candidate = find_powershell().await?;
            (
                PathBuf::from(candidate.program),
                vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-File".to_string(),
                    entry.to_string_lossy().to_string(),
                ],
            )
        }
        RuntimeKind::Shell => {
            #[cfg(windows)]
            {
                (
                    PathBuf::from("cmd.exe"),
                    vec![
                        "/D".to_string(),
                        "/S".to_string(),
                        "/C".to_string(),
                        entry.to_string_lossy().to_string(),
                    ],
                )
            }
            #[cfg(not(windows))]
            {
                ensure_command("sh", &["-c", "exit 0"]).await?;
                (
                    PathBuf::from("sh"),
                    vec![entry.to_string_lossy().to_string()],
                )
            }
        }
        RuntimeKind::Executable => (entry.clone(), Vec::new()),
        RuntimeKind::Builtin | RuntimeKind::Http | RuntimeKind::Custom => {
            return Err(format!(
                "桌面进程层不支持运行时：{:?}",
                request.runtime.kind
            ));
        }
    };

    prefix_args.append(&mut args);

    let cwd = if let Some(template) = request.execution.cwd.as_deref() {
        let value = expand_template(template, &request.params)?;
        let path = PathBuf::from(value);
        if !path.is_dir() {
            return Err("execution.cwd 必须指向存在的目录。".to_string());
        }
        path
    } else {
        entry
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(std::env::current_dir().map_err(|error| error.to_string())?)
    };

    let mut env = HashMap::new();
    for (key, template) in &request.execution.env {
        if !is_valid_env_key(key) {
            return Err(format!("环境变量名称不合法：{key}"));
        }
        env.insert(key.clone(), expand_template(template, &request.params)?);
    }

    let timeout = request
        .execution
        .timeout_seconds
        .unwrap_or(3600)
        .clamp(1, MAX_TIMEOUT_SECONDS);

    Ok(ResolvedCommand {
        program,
        args: prefix_args,
        cwd,
        env,
        timeout: Duration::from_secs(timeout),
    })
}

async fn find_python() -> Result<RuntimeCandidate, String> {
    #[cfg(windows)]
    let candidates: &[(&str, &[&str], &[&str])] = &[
        ("py", &["-3"], &["-3", "--version"]),
        ("python", &[], &["--version"]),
        ("python3", &[], &["--version"]),
    ];
    #[cfg(not(windows))]
    let candidates: &[(&str, &[&str], &[&str])] = &[
        ("python3", &[], &["--version"]),
        ("python", &[], &["--version"]),
    ];

    for (program, prefix, check_args) in candidates {
        if let Ok(version) = command_output(program, check_args).await {
            return Ok(RuntimeCandidate {
                program: (*program).to_string(),
                prefix_args: prefix.iter().map(|value| (*value).to_string()).collect(),
                version,
            });
        }
    }
    Err("未找到可用的 Python 3 运行时。".to_string())
}

async fn find_powershell() -> Result<RuntimeCandidate, String> {
    #[cfg(windows)]
    let candidates = ["pwsh", "powershell.exe"];
    #[cfg(not(windows))]
    let candidates = ["pwsh"];

    for program in candidates {
        if let Ok(version) = command_output(
            program,
            &["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
        )
        .await
        {
            return Ok(RuntimeCandidate {
                program: program.to_string(),
                prefix_args: Vec::new(),
                version,
            });
        }
    }
    Err("未找到 PowerShell（pwsh 或 powershell.exe）。".to_string())
}

async fn detect_runtime(runtime: RuntimeKind) -> RuntimeStatus {
    let result = match runtime {
        RuntimeKind::Python => find_python()
            .await
            .map(|candidate| (candidate.program, candidate.version)),
        RuntimeKind::Node => command_output("node", &["--version"])
            .await
            .map(|version| ("node".to_string(), version)),
        RuntimeKind::Powershell => find_powershell()
            .await
            .map(|candidate| (candidate.program, candidate.version)),
        RuntimeKind::Shell => {
            #[cfg(windows)]
            let result = command_output("cmd.exe", &["/D", "/C", "ver"])
                .await
                .map(|version| ("cmd.exe".to_string(), version));
            #[cfg(not(windows))]
            let result = command_output("sh", &["-c", "printf tools-deck-shell"])
                .await
                .map(|version| ("sh".to_string(), version));
            result
        }
        _ => Err("该运行时不需要环境探测。".to_string()),
    };

    match result {
        Ok((command, version)) => RuntimeStatus {
            runtime,
            available: true,
            command: Some(command),
            version: Some(version),
            error: None,
        },
        Err(error) => RuntimeStatus {
            runtime,
            available: false,
            command: None,
            version: None,
            error: Some(error),
        },
    }
}

async fn ensure_command(program: &str, args: &[&str]) -> Result<(), String> {
    command_output(program, args).await.map(|_| ())
}

async fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("{program} 不可用：{error}"))?;

    if !output.status.success() {
        return Err(format!("{program} 返回非零状态。"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

fn resolve_entry_path(
    app: &AppHandle,
    value: &str,
    runtime: &RuntimeKind,
) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let resolved = if path.is_absolute() {
        path
    } else {
        if path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return Err("相对入口路径不能包含 ..。".to_string());
        }

        let mut candidates = Vec::new();
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join(&path));
        }
        if let Ok(current_dir) = std::env::current_dir() {
            candidates.push(current_dir.join(&path));
            if let Some(parent) = current_dir.parent() {
                candidates.push(parent.join(&path));
            }
        }
        if let Some(project_root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            candidates.push(project_root.join(&path));
        }

        candidates
            .into_iter()
            .find(|candidate| candidate.is_file())
            .ok_or_else(|| format!("找不到入口文件：{value}"))?
    };

    if !resolved.is_file() {
        return Err(format!("入口文件不存在：{}", resolved.to_string_lossy()));
    }
    validate_entry_extension(&resolved, runtime)?;
    Ok(resolved)
}

fn validate_entry_extension(path: &Path, runtime: &RuntimeKind) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let allowed = match runtime {
        RuntimeKind::Python => matches!(extension.as_str(), "py" | "pyw"),
        RuntimeKind::Node => matches!(extension.as_str(), "js" | "mjs" | "cjs"),
        RuntimeKind::Powershell => extension == "ps1",
        RuntimeKind::Shell => {
            #[cfg(windows)]
            {
                matches!(extension.as_str(), "cmd" | "bat")
            }
            #[cfg(not(windows))]
            {
                matches!(extension.as_str(), "sh" | "bash" | "zsh")
            }
        }
        RuntimeKind::Executable => true,
        _ => false,
    };

    if allowed {
        Ok(())
    } else {
        Err(format!(
            "入口文件扩展名与运行时不匹配：{}",
            path.to_string_lossy()
        ))
    }
}

fn expand_args(
    templates: &[String],
    params: &HashMap<String, Value>,
) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    for template in templates {
        if let Some(key) = exact_placeholder(template) {
            match params.get(key) {
                Some(Value::Array(values)) => {
                    for value in values {
                        args.push(value_to_string(value)?);
                    }
                }
                Some(value) => args.push(value_to_string(value)?),
                None => return Err(format!("缺少参数：{key}")),
            }
        } else {
            args.push(expand_template(template, params)?);
        }
    }
    Ok(args)
}

fn expand_template(template: &str, params: &HashMap<String, Value>) -> Result<String, String> {
    let mut output = String::new();
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| format!("未闭合的参数模板：{template}"))?;
        let key = after[..end].trim();
        let value = params
            .get(key)
            .ok_or_else(|| format!("模板引用了不存在的参数：{key}"))?;
        output.push_str(&value_to_string(value)?);
        rest = &after[end + 2..];
    }

    output.push_str(rest);
    Ok(output)
}

fn exact_placeholder(template: &str) -> Option<&str> {
    let trimmed = template.trim();
    trimmed
        .strip_prefix("{{")
        .and_then(|value| value.strip_suffix("}}"))
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains("{{"))
}

fn value_to_string(value: &Value) -> Result<String, String> {
    match value {
        Value::Null => Ok(String::new()),
        Value::String(value) => Ok(value.clone()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value)
            .map_err(|error| format!("序列化参数失败：{error}")),
    }
}

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.is_empty() || run_id.len() > 128 {
        return Err("runId 长度必须在 1 到 128 之间。".to_string());
    }
    if !run_id
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err("runId 只能包含字母、数字、连字符和下划线。".to_string());
    }
    Ok(())
}

fn is_valid_env_key(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn expands_scalar_and_array_arguments() {
        let params = HashMap::from([
            ("name".to_string(), json!("demo")),
            ("files".to_string(), json!(["a.txt", "b.txt"])),
        ]);
        let args = expand_args(
            &["--name={{name}}".to_string(), "{{files}}".to_string()],
            &params,
        )
        .unwrap();
        assert_eq!(args, vec!["--name=demo", "a.txt", "b.txt"]);
    }

    #[test]
    fn expands_boolean_and_numeric_values() {
        let params = HashMap::from([
            ("enabled".to_string(), json!(true)),
            ("count".to_string(), json!(3)),
        ]);
        assert_eq!(expand_template("{{enabled}}-{{count}}", &params).unwrap(), "true-3");
    }

    #[test]
    fn rejects_invalid_run_id() {
        assert!(validate_run_id("bad/run").is_err());
        assert!(validate_run_id("valid-run_01").is_ok());
    }
}
