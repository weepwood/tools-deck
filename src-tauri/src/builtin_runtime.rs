use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

use tauri::{ipc::Channel, State};
use tokio::sync::Mutex;

use crate::{
    builtins,
    models::{RunEvent, RunResult, RuntimeKind, ToolRunRequest},
};

#[derive(Default)]
pub struct BuiltinRegistry {
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[tauri::command]
pub async fn run_builtin_tool(
    state: State<'_, BuiltinRegistry>,
    request: ToolRunRequest,
    on_event: Channel<RunEvent>,
) -> Result<RunResult, String> {
    validate_run_id(&request.run_id)?;
    if request.runtime.kind != RuntimeKind::Builtin {
        return Err("run_builtin_tool 仅接受 builtin 运行时。".to_string());
    }

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut registry = state.inner.lock().await;
        if registry.contains_key(&request.run_id) {
            return Err("相同 runId 的内置任务已经在运行。".to_string());
        }
        registry.insert(request.run_id.clone(), cancelled.clone());
    }

    let started = Instant::now();
    let run_id = request.run_id.clone();
    let result = builtins::run_builtin(request, on_event, cancelled.clone()).await;

    {
        let mut registry = state.inner.lock().await;
        registry.remove(&run_id);
    }

    if cancelled.load(Ordering::SeqCst) {
        return Ok(RunResult {
            run_id,
            status: "cancelled".to_string(),
            duration: started.elapsed().as_millis(),
            summary: "任务已取消".to_string(),
            exit_code: None,
            artifacts: Vec::new(),
        });
    }

    result
}

#[tauri::command]
pub async fn cancel_builtin(
    run_id: String,
    state: State<'_, BuiltinRegistry>,
) -> Result<bool, String> {
    let cancellation = {
        let registry = state.inner.lock().await;
        registry.get(&run_id).cloned()
    };

    let Some(cancellation) = cancellation else {
        return Ok(false);
    };
    cancellation.store(true, Ordering::SeqCst);
    Ok(true)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_builtin_run_ids() {
        assert!(validate_run_id("builtin-01_test").is_ok());
        assert!(validate_run_id("bad/run").is_err());
    }
}
