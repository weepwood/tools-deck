use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use calamine::{open_workbook_auto, Data, Reader};
use chrono::{DateTime, Local, Utc};
use futures_util::{stream, StreamExt};
use git2::{BranchType, Repository, Status, StatusOptions};
use image::{codecs::jpeg::JpegEncoder, ImageFormat, ImageReader};
use reqwest::Client;
use rust_xlsxwriter::{Workbook, Worksheet};
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::ipc::Channel;
use tokio::{task, time::sleep};
use walkdir::WalkDir;

use crate::models::{Artifact, RunEvent, RunResult, ToolRunRequest};

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

pub async fn run_builtin(
    request: ToolRunRequest,
    on_event: Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<RunResult, String> {
    let started = Instant::now();
    send_started(&request, &on_event);

    let artifacts = match request.tool_id.as_str() {
        "image-compressor" => {
            run_blocking(request.clone(), on_event.clone(), cancelled.clone(), run_image_compressor)
                .await?
        }
        "batch-renamer" => {
            run_blocking(request.clone(), on_event.clone(), cancelled.clone(), run_batch_renamer)
                .await?
        }
        "excel-merger" => {
            run_blocking(request.clone(), on_event.clone(), cancelled.clone(), run_excel_merger)
                .await?
        }
        "http-batch-check" => {
            run_http_batch_check(&request, &on_event, cancelled.clone()).await?
        }
        "git-repo-audit" => {
            run_blocking(request.clone(), on_event.clone(), cancelled.clone(), run_git_audit)
                .await?
        }
        "json-formatter" => run_json_formatter(&request, &on_event, cancelled.clone())?,
        id => return Err(format!("未知的内置工具：{id}")),
    };

    if cancelled.load(Ordering::SeqCst) {
        return Ok(cancelled_result(request.run_id, started.elapsed().as_millis()));
    }

    Ok(RunResult {
        run_id: request.run_id,
        status: "success".to_string(),
        duration: started.elapsed().as_millis(),
        summary: format!("{} 执行完成", request.tool_name),
        exit_code: Some(0),
        artifacts,
    })
}

async fn run_blocking<F>(
    request: ToolRunRequest,
    on_event: Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
    runner: F,
) -> Result<Vec<Artifact>, String>
where
    F: FnOnce(&ToolRunRequest, &Channel<RunEvent>, Arc<AtomicBool>) -> Result<Vec<Artifact>, String>
        + Send
        + 'static,
{
    task::spawn_blocking(move || runner(&request, &on_event, cancelled))
        .await
        .map_err(|error| format!("内置任务线程异常：{error}"))?
}

fn run_image_compressor(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<Artifact>, String> {
    let source = canonical_directory(&required_string(request, "input")?, "输入文件夹")?;
    let output_value = required_string(request, "output")?;
    let output = PathBuf::from(output_value).expand_home();
    fs::create_dir_all(&output).map_err(|error| format!("创建输出目录失败：{error}"))?;
    let output = output
        .canonicalize()
        .map_err(|error| format!("解析输出目录失败：{error}"))?;

    if same_or_descendant(&output, &source) {
        return Err("输出文件夹不能与输入文件夹相同，也不能位于输入文件夹内部。".to_string());
    }

    let quality = number_param(request, "quality", 82.0).clamp(30.0, 100.0) as u8;
    let recursive = bool_param(request, "recursive", true);
    let mut files = Vec::new();
    let walker = if recursive {
        WalkDir::new(&source)
    } else {
        WalkDir::new(&source).max_depth(1)
    };

    for entry in walker.into_iter() {
        ensure_running(&cancelled)?;
        let entry = entry.map_err(|error| format!("扫描图片目录失败：{error}"))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let extension = extension_lower(entry.path());
        if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            files.push(entry.into_path());
        }
    }
    files.sort_by_key(|path| path.to_string_lossy().to_lowercase());

    send_progress(request, on_event, 5, format!("找到 {} 张图片", files.len()), "info");
    let total = files.len().max(1);

    for (index, file) in files.iter().enumerate() {
        ensure_running(&cancelled)?;
        let relative = file
            .strip_prefix(&source)
            .map_err(|error| format!("计算图片相对路径失败：{error}"))?;
        let target = output.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建输出子目录失败：{error}"))?;
        }

        let image = ImageReader::open(file)
            .map_err(|error| format!("打开图片 {} 失败：{error}", file.display()))?
            .with_guessed_format()
            .map_err(|error| format!("识别图片格式 {} 失败：{error}", file.display()))?
            .decode()
            .map_err(|error| format!("解码图片 {} 失败：{error}", file.display()))?;

        match extension_lower(file).as_str() {
            "jpg" | "jpeg" => {
                let writer = BufWriter::new(
                    File::create(&target)
                        .map_err(|error| format!("创建图片 {} 失败：{error}", target.display()))?,
                );
                JpegEncoder::new_with_quality(writer, quality)
                    .encode_image(&image)
                    .map_err(|error| format!("编码 JPEG {} 失败：{error}", target.display()))?;
            }
            "png" => image
                .save_with_format(&target, ImageFormat::Png)
                .map_err(|error| format!("编码 PNG {} 失败：{error}", target.display()))?,
            "webp" => image
                .save_with_format(&target, ImageFormat::WebP)
                .map_err(|error| format!("编码 WebP {} 失败：{error}", target.display()))?,
            _ => continue,
        }

        send_progress(
            request,
            on_event,
            progress(index + 1, total, 5, 95),
            format!("[{}/{}] {}", index + 1, files.len(), relative.display()),
            "info",
        );
    }

    send_progress(request, on_event, 100, format!("压缩完成：{} 张图片", files.len()), "success");
    Ok(vec![directory_artifact("压缩结果目录", &output)])
}

fn run_batch_renamer(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<Artifact>, String> {
    let directory = canonical_directory(&required_string(request, "directory")?, "目标目录")?;
    let prefix = string_param(request, "prefix").unwrap_or_else(|| "file-".to_string());
    if prefix.chars().any(|character| matches!(character, '/' | '\\' | '\0')) {
        return Err("文件名前缀不能包含路径分隔符或空字符。".to_string());
    }
    let start = number_param(request, "start", 1.0).max(0.0) as u64;
    let dry_run = bool_param(request, "dryRun", true);

    let mut files = fs::read_dir(&directory)
        .map_err(|error| format!("读取目标目录失败：{error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    files.sort_by_key(|path| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });

    let plans = files
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let extension = source
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy()))
                .unwrap_or_default();
            let target_name = format!("{}{:04}{}", prefix, start + index as u64, extension);
            let target = directory.join(&target_name);
            RenamePlan {
                source: source.clone(),
                target,
                target_name,
                temporary: None,
            }
        })
        .collect::<Vec<_>>();

    validate_rename_plans(&plans)?;
    send_progress(request, on_event, 5, format!("找到 {} 个文件", plans.len()), "info");

    let output_dir = run_output_dir(&request.run_id)?;
    let report = output_dir.join("rename-plan.csv");
    let mut rows = Vec::with_capacity(plans.len());

    if dry_run {
        for (index, plan) in plans.iter().enumerate() {
            ensure_running(&cancelled)?;
            rows.push((file_name(&plan.source), plan.target_name.clone(), "preview"));
            send_progress(
                request,
                on_event,
                progress(index + 1, plans.len().max(1), 5, 95),
                format!("{} → {}", file_name(&plan.source), plan.target_name),
                "info",
            );
        }
    } else {
        execute_rename_plans(request, on_event, cancelled.clone(), plans, &mut rows)?;
    }

    write_csv(
        &report,
        &["原文件名", "新文件名", "状态"],
        rows.into_iter()
            .map(|(source, target, status)| vec![source, target, status.to_string()]),
    )?;
    send_progress(
        request,
        on_event,
        100,
        if dry_run { "重命名预览完成" } else { "文件重命名完成" },
        "success",
    );
    Ok(vec![file_artifact(
        if dry_run { "重命名预览清单" } else { "重命名结果清单" },
        &report,
    )])
}

fn run_excel_merger(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<Artifact>, String> {
    let files = path_list_param(request, "files")?;
    if files.is_empty() {
        return Err("至少选择一个 Excel 文件。".to_string());
    }
    let sheet_name = string_param(request, "sheet").unwrap_or_else(|| "Sheet1".to_string());
    let add_source = bool_param(request, "sourceColumn", true);
    let output_name = safe_output_name(
        &string_param(request, "outputName").unwrap_or_else(|| "merged.xlsx".to_string()),
        "merged.xlsx",
    );
    let output_dir = run_output_dir(&request.run_id)?;
    let output_path = output_dir.join(output_name);

    let mut workbook_out = Workbook::new();
    let worksheet = workbook_out.add_worksheet_with_constant_memory();
    worksheet
        .set_name("Merged")
        .map_err(|error| format!("设置输出工作表名称失败：{error}"))?;

    let mut expected_header: Option<Vec<String>> = None;
    let mut header_columns: Option<usize> = None;
    let mut output_row: u32 = 0;
    let mut total_rows: u64 = 0;

    for (index, file) in files.iter().enumerate() {
        ensure_running(&cancelled)?;
        if !file.is_file() {
            return Err(format!("Excel 文件不存在：{}", file.display()));
        }
        let mut workbook = open_workbook_auto(file)
            .map_err(|error| format!("打开 Excel 文件 {} 失败：{error}", file.display()))?;
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|error| format!("读取 {} 的工作表 {} 失败：{error}", file.display(), sheet_name))?;
        let mut rows = range.rows();
        let Some(header) = rows.next() else {
            continue;
        };
        let current_header = header.iter().map(cell_text).collect::<Vec<_>>();

        match &expected_header {
            None => {
                for (column, cell) in header.iter().enumerate() {
                    write_excel_cell(worksheet, output_row, column, cell)?;
                }
                if add_source {
                    let source_column = u16::try_from(header.len())
                        .map_err(|_| "Excel 列数超出限制。".to_string())?;
                    worksheet
                        .write_string(output_row, source_column, "来源文件")
                        .map_err(|error| format!("写入来源文件表头失败：{error}"))?;
                }
                header_columns = Some(header.len());
                expected_header = Some(current_header);
                output_row += 1;
            }
            Some(expected) if expected != &current_header => {
                return Err(format!("{} 的表头与第一个文件不一致。", file.display()));
            }
            Some(_) => {}
        }

        let expected_columns = header_columns.unwrap_or(header.len());
        for row in rows {
            ensure_running(&cancelled)?;
            if row.len() > expected_columns {
                return Err(format!("{} 存在超出表头范围的数据列。", file.display()));
            }
            for (column, cell) in row.iter().enumerate() {
                write_excel_cell(worksheet, output_row, column, cell)?;
            }
            if add_source {
                let source_column = u16::try_from(expected_columns)
                    .map_err(|_| "Excel 列数超出限制。".to_string())?;
                worksheet
                    .write_string(output_row, source_column, file_name(file))
                    .map_err(|error| format!("写入来源文件列失败：{error}"))?;
            }
            output_row = output_row
                .checked_add(1)
                .ok_or_else(|| "输出 Excel 行数超出限制。".to_string())?;
            total_rows += 1;
        }

        send_progress(
            request,
            on_event,
            progress(index + 1, files.len(), 5, 95),
            format!("[{}/{}] 已合并 {}", index + 1, files.len(), file_name(file)),
            "info",
        );
    }

    workbook_out
        .save(&output_path)
        .map_err(|error| format!("保存合并后的 Excel 失败：{error}"))?;
    send_progress(
        request,
        on_event,
        100,
        format!("合并完成：{} 个文件，{} 行", files.len(), total_rows),
        "success",
    );
    Ok(vec![file_artifact(file_name(&output_path), &output_path)])
}

async fn run_http_batch_check(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<Artifact>, String> {
    let urls = string_lines_param(request, "urls");
    if urls.is_empty() {
        return Err("URL 列表不能为空。".to_string());
    }
    let timeout_seconds = number_param(request, "timeout", 10.0).clamp(1.0, 120.0) as u64;
    let concurrency = number_param(request, "concurrency", 5.0).clamp(1.0, 20.0) as usize;
    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent("Tools-Deck/0.4")
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    send_progress(request, on_event, 5, format!("准备检测 {} 个 URL", urls.len()), "info");
    let total = urls.len();
    let mut results = stream::iter(urls.into_iter().enumerate().map(|(index, url)| {
        let client = client.clone();
        let cancelled = cancelled.clone();
        async move {
            let started = Instant::now();
            let request_future = client.get(&url).send();
            tokio::pin!(request_future);
            let result = tokio::select! {
                response = &mut request_future => Some(response),
                _ = wait_for_cancellation(cancelled.clone()) => None,
            };
            match result {
                Some(Ok(response)) => HttpCheckResult {
                    index,
                    url,
                    status: response.status().as_u16(),
                    duration_ms: started.elapsed().as_secs_f64() * 1000.0,
                    final_url: response.url().to_string(),
                    error: String::new(),
                },
                Some(Err(error)) => HttpCheckResult {
                    index,
                    final_url: url.clone(),
                    url,
                    status: 0,
                    duration_ms: started.elapsed().as_secs_f64() * 1000.0,
                    error: error.to_string(),
                },
                None => HttpCheckResult::cancelled(index, url),
            }
        }
    }))
    .buffer_unordered(concurrency);

    let mut completed = 0usize;
    let mut rows = Vec::with_capacity(total);
    while let Some(result) = results.next().await {
        ensure_running(&cancelled)?;
        completed += 1;
        send_progress(
            request,
            on_event,
            progress(completed, total, 5, 95),
            format!(
                "[{completed}/{total}] {} → {}",
                result.url,
                if result.status == 0 { "失败".to_string() } else { result.status.to_string() }
            ),
            if result.error.is_empty() { "info" } else { "warning" },
        );
        rows.push(result);
    }
    rows.sort_by_key(|result| result.index);

    let output_dir = run_output_dir(&request.run_id)?;
    let report = output_dir.join("http-check-report.csv");
    write_csv(
        &report,
        &["url", "status", "duration_ms", "final_url", "error"],
        rows.into_iter().map(|result| {
            vec![
                result.url,
                result.status.to_string(),
                format!("{:.2}", result.duration_ms),
                result.final_url,
                result.error,
            ]
        }),
    )?;
    send_progress(request, on_event, 100, format!("检测完成：{total} 个 URL"), "success");
    Ok(vec![file_artifact("HTTP 检测报告", &report)])
}

fn run_git_audit(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<Artifact>, String> {
    let repository_path = canonical_directory(&required_string(request, "repository")?, "仓库目录")?;
    let stale_days = number_param(request, "staleDays", 90.0).max(7.0) as i64;
    let repository = Repository::open(&repository_path)
        .map_err(|error| format!("目标目录不是可读取的 Git 仓库：{error}"))?;

    send_progress(request, on_event, 15, "正在读取 Git 仓库状态", "info");
    ensure_running(&cancelled)?;
    let branch = repository
        .head()
        .ok()
        .and_then(|head| head.shorthand().ok().map(str::to_string))
        .unwrap_or_else(|| "DETACHED HEAD".to_string());

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(|error| format!("读取 Git 工作区状态失败：{error}"))?;
    let mut changed = statuses
        .iter()
        .filter_map(|entry| {
            let path = entry.path().ok()?.to_string();
            Some(format!("{}  {}", status_code(entry.status()), path))
        })
        .collect::<Vec<_>>();
    changed.sort();

    send_progress(request, on_event, 55, "正在检查本地分支", "info");
    ensure_running(&cancelled)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("读取系统时间失败：{error}"))?
        .as_secs() as i64;
    let cutoff = now - stale_days * 24 * 60 * 60;
    let mut stale_branches = Vec::new();
    let branches = repository
        .branches(Some(BranchType::Local))
        .map_err(|error| format!("读取本地分支失败：{error}"))?;
    for branch_result in branches {
        ensure_running(&cancelled)?;
        let (branch_ref, _) = branch_result.map_err(|error| format!("读取分支失败：{error}"))?;
        let name = branch_ref
            .name()
            .map_err(|error| format!("读取分支名称失败：{error}"))?
            .unwrap_or("<non-utf8>")
            .to_string();
        let commit = branch_ref
            .get()
            .peel_to_commit()
            .map_err(|error| format!("读取分支提交失败：{error}"))?;
        let timestamp = commit.time().seconds();
        if timestamp < cutoff {
            let date = DateTime::<Utc>::from_timestamp(timestamp, 0)
                .map(|value| value.with_timezone(&Local).format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| timestamp.to_string());
            stale_branches.push(format!("{name} ({date})"));
        }
    }
    stale_branches.sort();

    send_progress(request, on_event, 80, "正在生成巡检报告", "info");
    let output_dir = run_output_dir(&request.run_id)?;
    let report = output_dir.join("git-audit-report.md");
    let status_text = if changed.is_empty() {
        "工作区干净".to_string()
    } else {
        changed.join("\n")
    };
    let stale_text = if stale_branches.is_empty() {
        "无".to_string()
    } else {
        stale_branches.join("\n")
    };
    let content = format!(
        "# Git 仓库巡检报告\n\n- 仓库：{}\n- 当前分支：{}\n- 过期分支阈值：{} 天\n\n## 工作区状态\n\n```text\n{}\n```\n\n## 过期本地分支\n\n```text\n{}\n```\n",
        repository_path.display(), branch, stale_days, status_text, stale_text
    );
    fs::write(&report, content).map_err(|error| format!("写入 Git 巡检报告失败：{error}"))?;
    send_progress(request, on_event, 100, "Git 仓库巡检完成", "success");
    Ok(vec![file_artifact("Git 巡检报告", &report)])
}

fn run_json_formatter(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<Artifact>, String> {
    ensure_running(&cancelled)?;
    send_progress(request, on_event, 20, "正在解析 JSON 内容", "info");
    let content = required_string(request, "content")?;
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|error| format!("JSON 解析失败：{error}"))?;
    let sort_keys = bool_param(request, "sortKeys", false);
    let normalized = if sort_keys { sort_json(parsed) } else { parsed };
    send_progress(
        request,
        on_event,
        60,
        if sort_keys { "正在递归排序对象键名" } else { "正在保留原始键名顺序" },
        "info",
    );
    ensure_running(&cancelled)?;

    let indent_value = string_param(request, "indent").unwrap_or_else(|| "2".to_string());
    let indent: &[u8] = match indent_value.as_str() {
        "4" => b"    ",
        "Tab" => b"\t",
        _ => b"  ",
    };
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent);
    let mut bytes = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, formatter);
    normalized
        .serialize(&mut serializer)
        .map_err(|error| format!("JSON 格式化失败：{error}"))?;
    let output = String::from_utf8(bytes).map_err(|error| format!("生成 UTF-8 JSON 失败：{error}"))?;
    send_progress(request, on_event, 100, "JSON 格式化完成", "success");
    Ok(vec![Artifact {
        kind: "text".to_string(),
        label: "格式化结果".to_string(),
        path: None,
        content: Some(output),
    }])
}

#[derive(Debug)]
struct RenamePlan {
    source: PathBuf,
    target: PathBuf,
    target_name: String,
    temporary: Option<PathBuf>,
}

#[derive(Debug)]
struct HttpCheckResult {
    index: usize,
    url: String,
    status: u16,
    duration_ms: f64,
    final_url: String,
    error: String,
}

impl HttpCheckResult {
    fn cancelled(index: usize, url: String) -> Self {
        Self {
            index,
            final_url: url.clone(),
            url,
            status: 0,
            duration_ms: 0.0,
            error: "cancelled".to_string(),
        }
    }
}

fn execute_rename_plans(
    request: &ToolRunRequest,
    on_event: &Channel<RunEvent>,
    cancelled: Arc<AtomicBool>,
    mut plans: Vec<RenamePlan>,
    rows: &mut Vec<(String, String, &'static str)>,
) -> Result<(), String> {
    let total = plans.len().max(1);
    for index in 0..plans.len() {
        if cancelled.load(Ordering::SeqCst) {
            rollback_all_renames(&plans);
            return Err("任务已取消".to_string());
        }
        let source = plans[index].source.clone();
        let target = plans[index].target.clone();
        let target_name = plans[index].target_name.clone();
        rows.push((file_name(&source), target_name, "renamed"));
        if same_path(&source, &target) {
            continue;
        }
        let temporary = unique_temporary_path(&source, &request.run_id, index)?;
        if let Err(error) = fs::rename(&source, &temporary) {
            rollback_all_renames(&plans);
            return Err(format!("暂存文件 {} 失败：{error}", source.display()));
        }
        plans[index].temporary = Some(temporary);
        send_progress(
            request,
            on_event,
            progress(index + 1, total, 5, 65),
            format!("准备重命名 {}", file_name(&source)),
            "info",
        );
    }

    for index in 0..plans.len() {
        if cancelled.load(Ordering::SeqCst) {
            rollback_all_renames(&plans);
            return Err("任务已取消".to_string());
        }
        let plan = &plans[index];
        let Some(temporary) = &plan.temporary else {
            continue;
        };
        if let Err(error) = fs::rename(temporary, &plan.target) {
            rollback_all_renames(&plans);
            return Err(format!("写入新文件名 {} 失败：{error}", plan.target.display()));
        }
        send_progress(
            request,
            on_event,
            progress(index + 1, total, 65, 95),
            format!("已写入 {}", plan.target_name),
            "info",
        );
    }
    Ok(())
}

fn rollback_all_renames(plans: &[RenamePlan]) {
    for plan in plans.iter().rev() {
        let Some(temporary) = &plan.temporary else {
            continue;
        };
        if plan.target.exists() && !temporary.exists() {
            let _ = fs::rename(&plan.target, temporary);
        }
    }
    for plan in plans.iter().rev() {
        let Some(temporary) = &plan.temporary else {
            continue;
        };
        if temporary.exists() {
            let _ = fs::rename(temporary, &plan.source);
        }
    }
}

fn validate_rename_plans(plans: &[RenamePlan]) -> Result<(), String> {
    let sources = plans
        .iter()
        .map(|plan| normalized_path_key(&plan.source))
        .collect::<HashSet<_>>();
    let mut targets = HashSet::new();
    for plan in plans {
        let target_key = normalized_path_key(&plan.target);
        if !targets.insert(target_key.clone()) {
            return Err(format!("生成了重复文件名：{}", plan.target_name));
        }
        if plan.target.exists() && !sources.contains(&target_key) {
            return Err(format!("目标文件已存在：{}", plan.target_name));
        }
    }
    Ok(())
}

fn unique_temporary_path(source: &Path, run_id: &str, index: usize) -> Result<PathBuf, String> {
    let parent = source.parent().ok_or_else(|| "无法解析文件父目录。".to_string())?;
    for attempt in 0..1000usize {
        let candidate = parent.join(format!(".tools-deck-{run_id}-{index}-{attempt}.tmp"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法生成唯一的临时文件名。".to_string())
}

fn write_excel_cell(
    worksheet: &mut Worksheet,
    row: u32,
    column: usize,
    cell: &Data,
) -> Result<(), String> {
    let column = u16::try_from(column).map_err(|_| "Excel 列数超出限制。".to_string())?;
    match cell {
        Data::Empty => Ok(()),
        Data::Int(value) => worksheet
            .write_number(row, column, *value as f64)
            .map(|_| ())
            .map_err(|error| format!("写入 Excel 整数失败：{error}")),
        Data::Float(value) => worksheet
            .write_number(row, column, *value)
            .map(|_| ())
            .map_err(|error| format!("写入 Excel 数字失败：{error}")),
        Data::Bool(value) => worksheet
            .write_boolean(row, column, *value)
            .map(|_| ())
            .map_err(|error| format!("写入 Excel 布尔值失败：{error}")),
        Data::String(value) => worksheet
            .write_string(row, column, value)
            .map(|_| ())
            .map_err(|error| format!("写入 Excel 文本失败：{error}")),
        value => worksheet
            .write_string(row, column, value.to_string())
            .map(|_| ())
            .map_err(|error| format!("写入 Excel 单元格失败：{error}")),
    }
}

fn sort_json(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(sort_json).collect()),
        Value::Object(object) => {
            let mut entries = object.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, sort_json(value)))
                    .collect::<Map<_, _>>(),
            )
        }
        other => other,
    }
}

fn send_started(request: &ToolRunRequest, channel: &Channel<RunEvent>) {
    let _ = channel.send(RunEvent::Started {
        run_id: request.run_id.clone(),
        message: format!("已启动内置工具「{}」", request.tool_name),
        pid: None,
    });
}

fn send_progress(
    request: &ToolRunRequest,
    channel: &Channel<RunEvent>,
    progress: u8,
    message: impl Into<String>,
    level: impl Into<String>,
) {
    let _ = channel.send(RunEvent::Progress {
        run_id: request.run_id.clone(),
        progress: progress.min(100),
        message: message.into(),
        level: level.into(),
    });
}

fn cancelled_result(run_id: String, duration: u128) -> RunResult {
    RunResult {
        run_id,
        status: "cancelled".to_string(),
        duration,
        summary: "任务已取消".to_string(),
        exit_code: None,
        artifacts: Vec::new(),
    }
}

fn ensure_running(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err("任务已取消".to_string())
    } else {
        Ok(())
    }
}

async fn wait_for_cancellation(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::SeqCst) {
        sleep(Duration::from_millis(50)).await;
    }
}

fn required_string(request: &ToolRunRequest, key: &str) -> Result<String, String> {
    string_param(request, key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("缺少参数：{key}"))
}

fn string_param(request: &ToolRunRequest, key: &str) -> Option<String> {
    request.params.get(key).and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    })
}

fn number_param(request: &ToolRunRequest, key: &str, default: f64) -> f64 {
    request
        .params
        .get(key)
        .and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(value) => value.parse().ok(),
            _ => None,
        })
        .unwrap_or(default)
}

fn bool_param(request: &ToolRunRequest, key: &str, default: bool) -> bool {
    request
        .params
        .get(key)
        .and_then(|value| match value {
            Value::Bool(value) => Some(*value),
            Value::String(value) => value.parse().ok(),
            _ => None,
        })
        .unwrap_or(default)
}

fn path_list_param(request: &ToolRunRequest, key: &str) -> Result<Vec<PathBuf>, String> {
    let values = match request.params.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| PathBuf::from(value).expand_home())
            .collect(),
        Some(Value::String(value)) => value
            .replace(';', "\n")
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| PathBuf::from(value).expand_home())
            .collect(),
        Some(_) => return Err(format!("参数 {key} 必须是路径数组或多行文本。")),
        None => Vec::new(),
    };
    Ok(values)
}

fn string_lines_param(request: &ToolRunRequest, key: &str) -> Vec<String> {
    match request.params.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        Some(Value::String(value)) => value
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn canonical_directory(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value).expand_home();
    if !path.is_dir() {
        return Err(format!("{label}不存在：{}", path.display()));
    }
    path.canonicalize()
        .map_err(|error| format!("解析{label}失败：{error}"))
}

fn run_output_dir(run_id: &str) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("tools-deck").join(run_id);
    if directory.exists() {
        fs::remove_dir_all(&directory)
            .map_err(|error| format!("清理任务输出目录失败：{error}"))?;
    }
    fs::create_dir_all(&directory).map_err(|error| format!("创建任务输出目录失败：{error}"))?;
    Ok(directory)
}

fn write_csv<I>(path: &Path, headers: &[&str], rows: I) -> Result<(), String>
where
    I: IntoIterator<Item = Vec<String>>,
{
    let mut file = BufWriter::new(
        File::create(path).map_err(|error| format!("创建 CSV 文件失败：{error}"))?,
    );
    file.write_all("\u{feff}".as_bytes())
        .map_err(|error| format!("写入 CSV BOM 失败：{error}"))?;
    writeln!(file, "{}", headers.iter().map(|value| csv_escape(value)).collect::<Vec<_>>().join(","))
        .map_err(|error| format!("写入 CSV 表头失败：{error}"))?;
    for row in rows {
        writeln!(file, "{}", row.iter().map(|value| csv_escape(value)).collect::<Vec<_>>().join(","))
            .map_err(|error| format!("写入 CSV 数据失败：{error}"))?;
    }
    file.flush().map_err(|error| format!("保存 CSV 文件失败：{error}"))
}

fn csv_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn progress(current: usize, total: usize, start: u8, end: u8) -> u8 {
    if total == 0 {
        return end;
    }
    let span = u64::from(end.saturating_sub(start));
    let value = u64::from(start) + (current.min(total) as u64 * span / total as u64);
    value.min(100) as u8
}

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn safe_output_name(value: &str, fallback: &str) -> String {
    let name = Path::new(value)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string());
    if name.to_ascii_lowercase().ends_with(".xlsx") {
        name
    } else {
        format!("{name}.xlsx")
    }
}

fn cell_text(cell: &Data) -> String {
    cell.to_string().trim().to_string()
}

fn file_artifact(label: impl Into<String>, path: &Path) -> Artifact {
    Artifact {
        kind: "file".to_string(),
        label: label.into(),
        path: Some(path.to_string_lossy().to_string()),
        content: Some(path.to_string_lossy().to_string()),
    }
}

fn directory_artifact(label: impl Into<String>, path: &Path) -> Artifact {
    Artifact {
        kind: "directory".to_string(),
        label: label.into(),
        path: Some(path.to_string_lossy().to_string()),
        content: Some(path.to_string_lossy().to_string()),
    }
}

fn status_code(status: Status) -> &'static str {
    if status.is_conflicted() {
        "UU"
    } else if status.contains(Status::INDEX_NEW) {
        "A "
    } else if status.contains(Status::WT_NEW) {
        "??"
    } else if status.contains(Status::INDEX_DELETED) {
        "D "
    } else if status.contains(Status::WT_DELETED) {
        " D"
    } else if status.contains(Status::INDEX_RENAMED) {
        "R "
    } else if status.contains(Status::WT_RENAMED) {
        " R"
    } else if status.contains(Status::INDEX_MODIFIED) {
        "M "
    } else if status.contains(Status::WT_MODIFIED) {
        " M"
    } else {
        "  "
    }
}

fn normalized_path_key(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    normalized_path_key(left) == normalized_path_key(right)
}

fn same_or_descendant(path: &Path, parent: &Path) -> bool {
    if cfg!(windows) {
        let path = path.to_string_lossy().to_lowercase();
        let parent = parent.to_string_lossy().to_lowercase();
        path == parent || path.starts_with(&(parent.clone() + "\\")) || path.starts_with(&(parent + "/"))
    } else {
        path == parent || path.starts_with(parent)
    }
}

trait ExpandHome {
    fn expand_home(self) -> PathBuf;
}

impl ExpandHome for PathBuf {
    fn expand_home(self) -> PathBuf {
        let Some(value) = self.to_str() else {
            return self;
        };
        if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
            if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
                let suffix = value
                    .trim_start_matches('~')
                    .trim_start_matches(|character| character == '/' || character == '\\');
                return PathBuf::from(home).join(suffix);
            }
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_nested_json_keys() {
        let input = json!({"z": 1, "a": {"d": 2, "b": 1}});
        let output = sort_json(input);
        assert_eq!(output.to_string(), r#"{"a":{"b":1,"d":2},"z":1}"#);
    }

    #[test]
    fn escapes_csv_values() {
        assert_eq!(csv_escape("a,\"b"), "\"a,\"\"b\"");
    }

    #[test]
    fn sanitizes_excel_output_name() {
        assert_eq!(safe_output_name("../report", "merged.xlsx"), "report.xlsx");
        assert_eq!(safe_output_name("report.xlsx", "merged.xlsx"), "report.xlsx");
    }

    #[test]
    fn calculates_progress_range() {
        assert_eq!(progress(1, 2, 10, 90), 50);
        assert_eq!(progress(2, 2, 10, 90), 90);
    }
}
