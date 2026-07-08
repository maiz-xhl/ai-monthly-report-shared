from __future__ import annotations

import json
import os
import sqlite3
import uuid
from collections import defaultdict
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "shared_records.db"

ROLE_ADMIN = "admin"
ROLE_SUPERVISOR = "supervisor"
ROLE_EMPLOYEE = "employee"
ROLE_AI = "ai_system"

OBJECTIVE_STATUSES = {"not_started", "in_progress", "at_risk", "completed", "paused", "cancelled"}
RESULT_STAGES = {"planning", "developing", "debugging", "testing", "launched", "optimizing", "archived", "paused", "cancelled"}
TASK_STATUSES = {"not_started", "developing", "debugging", "testing", "waiting", "paused", "completed", "launched", "cancelled"}
BLOCKER_REASONS = {
    "unclear_requirement",
    "technical_issue",
    "waiting_confirmation",
    "waiting_material",
    "waiting_api_data",
    "compatibility",
    "cross_department",
    "priority_change",
    "external_system",
    "other",
}
REVIEW_STATUSES = {"pending", "confirmed", "corrected", "invalid"}
REPORT_STATUSES = {"draft", "employee_review", "supervisor_review", "confirmed", "exported"}

STAGE_PROGRESS = {
    "planning": 0.15,
    "developing": 0.4,
    "debugging": 0.58,
    "testing": 0.72,
    "launched": 0.88,
    "optimizing": 0.93,
    "archived": 1.0,
    "paused": 0.0,
    "cancelled": 0.0,
}

USERS_SEED = [
    {
        "id": "u_admin_chen",
        "name": "",
        "department": "AI部",
        "roles": [ROLE_ADMIN],
        "position": "",
        "status": "active",
    },
]


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def month_string(value: str | None = None) -> str:
    dt = datetime.fromisoformat(value) if value else datetime.now()
    return dt.strftime("%Y-%m")


def to_json(value) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def from_json(value, default=None):
    if value in (None, ""):
        return [] if default is None else default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return [] if default is None else default


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    try:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    except sqlite3.OperationalError:
        return set()
    return {row["name"] for row in rows}


def ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, column_type: str) -> None:
    columns = table_columns(conn, table_name)
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")


def migrate_legacy_tables(conn: sqlite3.Connection) -> None:
    monthly_columns = table_columns(conn, "monthly_reports")
    if monthly_columns and "report_month" not in monthly_columns:
        conn.execute("ALTER TABLE monthly_reports RENAME TO legacy_monthly_reports")


def init_db() -> None:
    with get_connection() as conn:
        migrate_legacy_tables(conn)
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              department TEXT NOT NULL,
              roles_json TEXT NOT NULL,
              position TEXT,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS objectives (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT NOT NULL,
              success_criteria_json TEXT NOT NULL,
              owner_id TEXT NOT NULL,
              participant_ids_json TEXT NOT NULL,
              start_date TEXT NOT NULL,
              due_date TEXT NOT NULL,
              status TEXT NOT NULL,
              out_of_scope_json TEXT NOT NULL,
              ai_summary TEXT,
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS results (
              id TEXT PRIMARY KEY,
              objective_id TEXT NOT NULL,
              name TEXT NOT NULL,
              description TEXT NOT NULL,
              completion_criteria_json TEXT NOT NULL,
              expected_value TEXT NOT NULL,
              owner_id TEXT NOT NULL,
              participant_ids_json TEXT NOT NULL,
              stage TEXT NOT NULL,
              due_date TEXT NOT NULL,
              actual_completed_at TEXT,
              actual_launched_at TEXT,
              is_organization_asset INTEGER NOT NULL DEFAULT 0,
              asset_confirmed_by TEXT,
              ai_value_summary TEXT,
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              result_id TEXT NOT NULL,
              objective_id TEXT NOT NULL,
              owner_id TEXT NOT NULL,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              current_status TEXT NOT NULL,
              first_input_hours REAL NOT NULL,
              total_input_hours REAL NOT NULL,
              planned_complete_date TEXT,
              completed_at TEXT,
              launched_at TEXT,
              last_progress_at TEXT,
              progress_count INTEGER NOT NULL DEFAULT 0,
              blocker_reason TEXT,
              issue_description TEXT,
              is_cross_month INTEGER NOT NULL DEFAULT 0,
              is_delayed INTEGER NOT NULL DEFAULT 0,
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_progress (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              progress_content TEXT NOT NULL,
              input_hours REAL NOT NULL,
              status_after_update TEXT NOT NULL,
              issue_description TEXT,
              blocker_reason TEXT,
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_analysis (
              id TEXT PRIMARY KEY,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              analysis_type TEXT NOT NULL,
              work_category_json TEXT,
              ability_tags_json TEXT,
              value_types_json TEXT,
              value_level TEXT,
              efficiency_judgement TEXT,
              growth_level TEXT,
              risk_types_json TEXT,
              risk_level TEXT,
              reasoning TEXT NOT NULL,
              confidence REAL,
              needs_manager_review INTEGER NOT NULL DEFAULT 0,
              generated_text TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS manager_reviews (
              id TEXT PRIMARY KEY,
              ai_analysis_id TEXT NOT NULL,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              reviewer_id TEXT NOT NULL,
              review_status TEXT NOT NULL,
              corrected_work_category_json TEXT,
              corrected_ability_tags_json TEXT,
              corrected_value_types_json TEXT,
              corrected_value_level TEXT,
              corrected_efficiency TEXT,
              corrected_growth_level TEXT,
              corrected_risk_types_json TEXT,
              corrected_risk_level TEXT,
              comment TEXT,
              next_step_suggestion TEXT,
              marked_for_review INTEGER NOT NULL DEFAULT 0,
              marked_as_asset INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS monthly_reports (
              id TEXT PRIMARY KEY,
              report_month TEXT NOT NULL,
              user_id TEXT NOT NULL,
              department TEXT NOT NULL,
              objective_ids_json TEXT NOT NULL,
              result_ids_json TEXT NOT NULL,
              task_ids_json TEXT NOT NULL,
              report_status TEXT NOT NULL,
              ai_generated_content_json TEXT NOT NULL,
              employee_supplement_json TEXT,
              supervisor_comment TEXT,
              final_content_json TEXT,
              generated_at TEXT NOT NULL,
              confirmed_by TEXT,
              confirmed_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(report_month, user_id)
            );

            CREATE TABLE IF NOT EXISTS attachments (
              id TEXT PRIMARY KEY,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              file_name TEXT,
              file_type TEXT,
              file_url TEXT NOT NULL,
              description TEXT,
              uploaded_by TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """
        )
        ensure_column(conn, "objectives", "source_type", "TEXT NOT NULL DEFAULT 'manager_assigned'")
        ensure_column(conn, "objectives", "source_department", "TEXT")
        ensure_column(conn, "objectives", "source_detail", "TEXT")



def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def normalize_role(value: str) -> str:
    return value if value in {ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_EMPLOYEE} else ROLE_EMPLOYEE


def normalize_roles(values) -> list[str]:
    if isinstance(values, str):
        values = [values]
    cleaned = []
    for value in values or []:
        role = normalize_role(str(value).strip())
        if role not in cleaned:
            cleaned.append(role)
    return cleaned or [ROLE_EMPLOYEE]


def reset_system_data(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM attachments")
    conn.execute("DELETE FROM manager_reviews")
    conn.execute("DELETE FROM ai_analysis")
    conn.execute("DELETE FROM task_progress")
    conn.execute("DELETE FROM tasks")
    conn.execute("DELETE FROM results")
    conn.execute("DELETE FROM objectives")
    conn.execute("DELETE FROM monthly_reports")
    conn.execute("DELETE FROM users")


def serialize_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "department": row["department"],
        "roles": from_json(row["roles_json"]),
        "position": row["position"] or "",
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def serialize_objective(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "sourceType": row["source_type"] or "manager_assigned",
        "sourceDepartment": row["source_department"] or "",
        "sourceDetail": row["source_detail"] or "",
        "successCriteria": from_json(row["success_criteria_json"]),
        "ownerId": row["owner_id"],
        "participantIds": from_json(row["participant_ids_json"]),
        "startDate": row["start_date"],
        "dueDate": row["due_date"],
        "status": row["status"],
        "outOfScope": from_json(row["out_of_scope_json"]),
        "aiSummary": row["ai_summary"] or "",
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def serialize_result(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "objectiveId": row["objective_id"],
        "name": row["name"],
        "description": row["description"],
        "completionCriteria": from_json(row["completion_criteria_json"]),
        "expectedValue": row["expected_value"],
        "ownerId": row["owner_id"],
        "participantIds": from_json(row["participant_ids_json"]),
        "stage": row["stage"],
        "dueDate": row["due_date"],
        "actualCompletedAt": row["actual_completed_at"],
        "actualLaunchedAt": row["actual_launched_at"],
        "isOrganizationAsset": bool(row["is_organization_asset"]),
        "assetConfirmedBy": row["asset_confirmed_by"],
        "aiValueSummary": row["ai_value_summary"] or "",
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def serialize_task(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "resultId": row["result_id"],
        "objectiveId": row["objective_id"],
        "ownerId": row["owner_id"],
        "title": row["title"],
        "content": row["content"],
        "currentStatus": row["current_status"],
        "firstInputHours": row["first_input_hours"],
        "totalInputHours": row["total_input_hours"],
        "plannedCompleteDate": row["planned_complete_date"],
        "completedAt": row["completed_at"],
        "launchedAt": row["launched_at"],
        "lastProgressAt": row["last_progress_at"],
        "progressCount": row["progress_count"],
        "blockerReason": row["blocker_reason"] or "",
        "issueDescription": row["issue_description"] or "",
        "isCrossMonth": bool(row["is_cross_month"]),
        "isDelayed": bool(row["is_delayed"]),
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def serialize_progress(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "taskId": row["task_id"],
        "progressContent": row["progress_content"],
        "inputHours": row["input_hours"],
        "statusAfterUpdate": row["status_after_update"],
        "issueDescription": row["issue_description"] or "",
        "blockerReason": row["blocker_reason"] or "",
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
    }


def serialize_analysis(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "targetType": row["target_type"],
        "targetId": row["target_id"],
        "analysisType": row["analysis_type"],
        "workCategory": from_json(row["work_category_json"]),
        "abilityTags": from_json(row["ability_tags_json"]),
        "valueTypes": from_json(row["value_types_json"]),
        "valueLevel": row["value_level"] or "",
        "efficiencyJudgement": row["efficiency_judgement"] or "",
        "growthLevel": row["growth_level"] or "",
        "riskTypes": from_json(row["risk_types_json"]),
        "riskLevel": row["risk_level"] or "",
        "reasoning": row["reasoning"],
        "confidence": row["confidence"] or 0,
        "needsManagerReview": bool(row["needs_manager_review"]),
        "generatedText": row["generated_text"] or "",
        "createdAt": row["created_at"],
    }


def serialize_review(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "aiAnalysisId": row["ai_analysis_id"],
        "targetType": row["target_type"],
        "targetId": row["target_id"],
        "reviewerId": row["reviewer_id"],
        "reviewStatus": row["review_status"],
        "correctedWorkCategory": from_json(row["corrected_work_category_json"]),
        "correctedAbilityTags": from_json(row["corrected_ability_tags_json"]),
        "correctedValueTypes": from_json(row["corrected_value_types_json"]),
        "correctedValueLevel": row["corrected_value_level"] or "",
        "correctedEfficiency": row["corrected_efficiency"] or "",
        "correctedGrowthLevel": row["corrected_growth_level"] or "",
        "correctedRiskTypes": from_json(row["corrected_risk_types_json"]),
        "correctedRiskLevel": row["corrected_risk_level"] or "",
        "comment": row["comment"] or "",
        "nextStepSuggestion": row["next_step_suggestion"] or "",
        "markedForReview": bool(row["marked_for_review"]),
        "markedAsAsset": bool(row["marked_as_asset"]),
        "createdAt": row["created_at"],
    }


def serialize_report(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "reportMonth": row["report_month"],
        "userId": row["user_id"],
        "department": row["department"],
        "objectiveIds": from_json(row["objective_ids_json"]),
        "resultIds": from_json(row["result_ids_json"]),
        "taskIds": from_json(row["task_ids_json"]),
        "reportStatus": row["report_status"],
        "aiGeneratedContent": from_json(row["ai_generated_content_json"], {}),
        "employeeSupplement": from_json(row["employee_supplement_json"], {}),
        "supervisorComment": row["supervisor_comment"] or "",
        "finalContent": from_json(row["final_content_json"], {}),
        "generatedAt": row["generated_at"],
        "confirmedBy": row["confirmed_by"],
        "confirmedAt": row["confirmed_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def ensure_status(value: str, allowed: set[str], default: str) -> str:
    return value if value in allowed else default


def user_roles(user_row: sqlite3.Row | dict | None) -> list[str]:
    if not user_row:
        return []
    if isinstance(user_row, dict):
        return user_row.get("roles", [])
    return from_json(user_row["roles_json"])


def get_viewer(conn: sqlite3.Connection, handler) -> sqlite3.Row | None:
    viewer_id = handler.headers.get("X-Viewer-Id") or parse_qs(urlparse(handler.path).query).get("viewer_id", [""])[0]
    if not viewer_id:
        return conn.execute("SELECT * FROM users ORDER BY created_at ASC LIMIT 1").fetchone()
    viewer = conn.execute("SELECT * FROM users WHERE id = ?", (viewer_id,)).fetchone()
    if viewer is not None:
        return viewer
    return conn.execute("SELECT * FROM users ORDER BY created_at ASC LIMIT 1").fetchone()


def require_role(conn: sqlite3.Connection, handler, roles: set[str]) -> sqlite3.Row | None:
    viewer = get_viewer(conn, handler)
    if viewer is None:
        handler.send_json({"error": "未找到当前用户。"}, HTTPStatus.UNAUTHORIZED)
        return None
    if not set(user_roles(viewer)).intersection(roles):
        handler.send_json({"error": "当前角色没有这个操作权限。"}, HTTPStatus.FORBIDDEN)
        return None
    return viewer


def days_between(start_text: str | None, end_text: str | None = None) -> int:
    if not start_text:
        return 0
    start = datetime.fromisoformat(start_text)
    end = datetime.fromisoformat(end_text) if end_text else datetime.now()
    return max((end - start).days, 0)


def task_span_days(task: dict) -> int:
    return days_between(task["createdAt"], task["launchedAt"] or task["completedAt"] or None)


def classify_work(task: dict, result: dict) -> list[str]:
    text = f"{task['title']} {task['content']} {task['issueDescription']} {result['name']} {result['description']}".lower()
    tags = []
    if any(keyword in text for keyword in ["流程", "自动化", "系统", "接口", "数据库", "表单"]):
        tags.append("自动化开发")
    if any(keyword in text for keyword in ["调试", "异常", "问题", "修复", "兼容"]):
        tags.append("调试测试")
    if any(keyword in text for keyword in ["看板", "月报", "分析", "规则"]):
        tags.append("规则设计")
    if any(keyword in text for keyword in ["协同", "确认", "部门"]):
        tags.append("跨部门支持")
    if not tags:
        tags.append("系统搭建")
    return list(dict.fromkeys(tags))


def infer_ability_tags(task: dict, result: dict) -> list[str]:
    text = f"{task['title']} {task['content']} {task['issueDescription']} {result['name']}".lower()
    tags = []
    if any(keyword in text for keyword in ["规则", "分析", "标签", "月报"]):
        tags.append("流程设计能力")
    if any(keyword in text for keyword in ["数据库", "接口", "python", "后端", "脚本", "自动化"]):
        tags.append("Python能力")
    if any(keyword in text for keyword in ["调试", "异常", "兼容", "修复"]):
        tags.append("问题排查能力")
        tags.append("调试测试能力")
    if any(keyword in text for keyword in ["系统", "模块", "看板", "表单"]):
        tags.append("Codex能力")
    if not tags:
        tags.append("执行能力")
    return list(dict.fromkeys(tags))


def infer_value(task: dict, result: dict) -> tuple[list[str], str]:
    text = f"{task['title']} {task['content']} {result['name']} {result['expectedValue']}".lower()
    value_types = []
    if any(keyword in text for keyword in ["月报", "看板", "管理", "可视化"]):
        value_types.append("提升管理可视化")
    if any(keyword in text for keyword in ["自动", "批量", "流程", "复用", "系统"]):
        value_types.append("形成复用")
        value_types.append("提升效率")
    if task["currentStatus"] == "launched":
        value_types.append("节约时间")
    if "跨部门" in text:
        value_types.append("支持跨部门")
    if not value_types:
        value_types.append("基础支持")
    unique = list(dict.fromkeys(value_types))

    if "提升管理可视化" in unique and "形成复用" in unique:
        level = "V5"
    elif "支持跨部门" in unique:
        level = "V4"
    elif "形成复用" in unique or "提升效率" in unique:
        level = "V3"
    elif task["currentStatus"] in {"completed", "launched"}:
        level = "V2"
    else:
        level = "V1"
    return unique, level


def infer_efficiency(task: dict, progress_items: list[dict]) -> str:
    if task["currentStatus"] in {"waiting", "paused"}:
        return "blocked"
    if task["totalInputHours"] >= 20 and task["progressCount"] >= 3:
        return "needs_review"
    if task["currentStatus"] in {"completed", "launched"} and task["totalInputHours"] <= 8 and task["progressCount"] <= 2:
        return "efficient"
    if task["currentStatus"] in {"developing", "debugging", "testing"} and days_between(task["lastProgressAt"]) > 7:
        return "uncertain"
    if any(item["statusAfterUpdate"] == "debugging" for item in progress_items) and task["progressCount"] >= 4:
        return "needs_review"
    return "normal"


def infer_growth_level(ability_tags: list[str], value_level: str) -> str:
    if value_level == "V5" or "流程设计能力" in ability_tags and "Codex能力" in ability_tags:
        return "L4"
    if value_level in {"V3", "V4"}:
        return "L3"
    if "问题排查能力" in ability_tags:
        return "L2"
    return "L1"


def infer_risks(task: dict, progress_items: list[dict]) -> tuple[list[str], str]:
    risks = []
    if task["currentStatus"] in {"developing", "debugging", "testing"} and days_between(task["lastProgressAt"]) > 7:
        risks.append("停滞风险")
    if task["currentStatus"] == "waiting":
        risks.append("协同风险")
    if task["currentStatus"] == "debugging" and task["progressCount"] >= 3:
        risks.append("质量风险")
    if task["blockerReason"] == "unclear_requirement":
        risks.append("需求风险")
    if task["isCrossMonth"]:
        risks.append("延期风险")
    if not task["resultId"]:
        risks.append("目标失焦风险")
    if not risks:
        return [], "low"
    if any(risk in risks for risk in ["停滞风险", "质量风险", "延期风险"]):
        return risks, "high" if len(risks) >= 2 else "medium"
    return risks, "medium"


def review_for_analysis(conn: sqlite3.Connection, analysis_id: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM manager_reviews WHERE ai_analysis_id = ? ORDER BY created_at DESC LIMIT 1",
        (analysis_id,),
    ).fetchone()
    return serialize_review(row) if row else None


def refresh_task_rollups(conn: sqlite3.Connection, task_id: str) -> None:
    task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if task_row is None:
        return
    progress_rows = conn.execute(
        "SELECT * FROM task_progress WHERE task_id = ? ORDER BY created_at ASC",
        (task_id,),
    ).fetchall()
    if not progress_rows:
        return
    first_task = serialize_task(task_row)
    progress = [serialize_progress(row) for row in progress_rows]
    total_input = round(sum(item["inputHours"] for item in progress), 2)
    latest = progress[-1]
    current_status = latest["statusAfterUpdate"]
    completed_at = task_row["completed_at"]
    launched_at = task_row["launched_at"]
    if current_status == "completed" and not completed_at:
        completed_at = latest["createdAt"]
    if current_status == "launched" and not launched_at:
        launched_at = latest["createdAt"]
    is_cross_month = int(month_string(first_task["createdAt"]) != month_string(latest["createdAt"]) and current_status not in {"completed", "launched", "cancelled"})
    planned_date = first_task["plannedCompleteDate"]
    is_delayed = 0
    if planned_date and current_status not in {"completed", "launched", "cancelled"} and planned_date < latest["createdAt"][:10]:
        is_delayed = 1
    conn.execute(
        """
        UPDATE tasks
        SET total_input_hours = ?, progress_count = ?, last_progress_at = ?, current_status = ?,
            completed_at = ?, launched_at = ?, is_cross_month = ?, is_delayed = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            total_input,
            len(progress),
            latest["createdAt"],
            current_status,
            completed_at,
            launched_at,
            is_cross_month,
            is_delayed,
            now_iso(),
            task_id,
        ),
    )


def upsert_task_analysis(conn: sqlite3.Connection, task_id: str) -> None:
    task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if task_row is None:
        return
    result_row = conn.execute("SELECT * FROM results WHERE id = ?", (task_row["result_id"],)).fetchone()
    if result_row is None:
        return
    progress_rows = conn.execute("SELECT * FROM task_progress WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
    task = serialize_task(task_row)
    result = serialize_result(result_row)
    progress = [serialize_progress(row) for row in progress_rows]

    work_category = classify_work(task, result)
    ability_tags = infer_ability_tags(task, result)
    value_types, value_level = infer_value(task, result)
    efficiency = infer_efficiency(task, progress)
    growth_level = infer_growth_level(ability_tags, value_level)
    risk_types, risk_level = infer_risks(task, progress)
    needs_review = int(
        value_level in {"V4", "V5"}
        or risk_level in {"medium", "high"}
        or task["isCrossMonth"]
        or task["totalInputHours"] >= 16
        or growth_level in {"L3", "L4", "L5"}
    )

    reasoning_parts = [
        f"当前状态：{task['currentStatus']}",
        f"累计投入：{task['totalInputHours']} 小时",
        f"进展次数：{task['progressCount']}",
        f"工期跨度：{task_span_days(task)} 天",
    ]
    if task["blockerReason"]:
        reasoning_parts.append(f"阻碍原因：{task['blockerReason']}")
    if risk_types:
        reasoning_parts.append(f"风险提示：{'、'.join(risk_types)}")
    reasoning = "；".join(reasoning_parts)

    summary = (
        f"事项“{task['title']}”当前处于{task['currentStatus']}，"
        f"AI判断工作分类为{'、'.join(work_category)}，价值等级为{value_level}，"
        f"效率判断为{efficiency}，成长层级暂估为{growth_level}。"
    )

    existing = conn.execute(
        "SELECT id FROM ai_analysis WHERE target_type = 'task' AND target_id = ? AND analysis_type = 'task_full'",
        (task_id,),
    ).fetchone()
    payload = (
        to_json(work_category),
        to_json(ability_tags),
        to_json(value_types),
        value_level,
        efficiency,
        growth_level,
        to_json(risk_types),
        risk_level,
        reasoning,
        0.72,
        needs_review,
        summary,
        now_iso(),
    )
    if existing:
        conn.execute(
            """
            UPDATE ai_analysis
            SET work_category_json = ?, ability_tags_json = ?, value_types_json = ?, value_level = ?,
                efficiency_judgement = ?, growth_level = ?, risk_types_json = ?, risk_level = ?,
                reasoning = ?, confidence = ?, needs_manager_review = ?, generated_text = ?, created_at = ?
            WHERE id = ?
            """,
            (*payload, existing["id"]),
        )
    else:
        conn.execute(
            """
            INSERT INTO ai_analysis (
              id, target_type, target_id, analysis_type, work_category_json, ability_tags_json,
              value_types_json, value_level, efficiency_judgement, growth_level, risk_types_json,
              risk_level, reasoning, confidence, needs_manager_review, generated_text, created_at
            ) VALUES (?, 'task', ?, 'task_full', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (make_id("analysis"), task_id, *payload),
        )


def tasks_for_month(conn: sqlite3.Connection, report_month: str) -> list[dict]:
    task_rows = conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC").fetchall()
    progress_map = defaultdict(list)
    for row in conn.execute("SELECT * FROM task_progress ORDER BY created_at ASC").fetchall():
        progress_map[row["task_id"]].append(serialize_progress(row))

    matches = []
    for row in task_rows:
        task = serialize_task(row)
        progress = progress_map.get(task["id"], [])
        active = any(item["createdAt"].startswith(report_month) for item in progress)
        created_this_month = task["createdAt"].startswith(report_month)
        completed_this_month = bool(task["completedAt"] and task["completedAt"].startswith(report_month))
        launched_this_month = bool(task["launchedAt"] and task["launchedAt"].startswith(report_month))
        if active or created_this_month or completed_this_month or launched_this_month:
            matches.append(task)
    return matches


def effective_analysis(conn: sqlite3.Connection, task_id: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM ai_analysis WHERE target_type = 'task' AND target_id = ? AND analysis_type = 'task_full'",
        (task_id,),
    ).fetchone()
    if row is None:
        return None
    analysis = serialize_analysis(row)
    review = review_for_analysis(conn, analysis["id"])
    if not review or review["reviewStatus"] == "invalid":
        analysis["review"] = review
        return analysis
    if review["correctedWorkCategory"]:
        analysis["workCategory"] = review["correctedWorkCategory"]
    if review["correctedAbilityTags"]:
        analysis["abilityTags"] = review["correctedAbilityTags"]
    if review["correctedValueTypes"]:
        analysis["valueTypes"] = review["correctedValueTypes"]
    if review["correctedValueLevel"]:
        analysis["valueLevel"] = review["correctedValueLevel"]
    if review["correctedEfficiency"]:
        analysis["efficiencyJudgement"] = review["correctedEfficiency"]
    if review["correctedGrowthLevel"]:
        analysis["growthLevel"] = review["correctedGrowthLevel"]
    if review["correctedRiskTypes"]:
        analysis["riskTypes"] = review["correctedRiskTypes"]
    if review["correctedRiskLevel"]:
        analysis["riskLevel"] = review["correctedRiskLevel"]
    analysis["review"] = review
    return analysis


def result_progress_summary(result: dict, tasks: list[dict]) -> dict:
    task_count = len(tasks)
    completed_count = sum(1 for task in tasks if task["currentStatus"] in {"completed", "launched"})
    launched_count = sum(1 for task in tasks if task["currentStatus"] == "launched")
    progress_ratio = STAGE_PROGRESS.get(result["stage"], 0)
    return {
        "resultId": result["id"],
        "name": result["name"],
        "stage": result["stage"],
        "taskCount": task_count,
        "completedTasks": completed_count,
        "launchedTasks": launched_count,
        "progressRatio": progress_ratio,
    }


def objective_progress_summary(objective: dict, related_results: list[dict]) -> dict:
    if not related_results:
        progress = 0
    else:
        progress = round(sum(STAGE_PROGRESS.get(item["stage"], 0) for item in related_results) / len(related_results), 2)
    return {
        "objectiveId": objective["id"],
        "name": objective["name"],
        "status": objective["status"],
        "progressRatio": progress,
    }


def generate_report_for_user(conn: sqlite3.Connection, user_id: str, report_month: str) -> dict:
    user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user_row is None:
        raise ValueError("用户不存在")
    user = serialize_user(user_row)

    all_tasks = tasks_for_month(conn, report_month)
    user_tasks = [task for task in all_tasks if task["ownerId"] == user_id]
    result_ids = sorted({task["resultId"] for task in user_tasks})
    objective_ids = sorted({task["objectiveId"] for task in user_tasks})

    result_rows = [serialize_result(row) for row in conn.execute("SELECT * FROM results WHERE id IN ({})".format(",".join("?" * len(result_ids))), result_ids).fetchall()] if result_ids else []
    objective_rows = [serialize_objective(row) for row in conn.execute("SELECT * FROM objectives WHERE id IN ({})".format(",".join("?" * len(objective_ids))), objective_ids).fetchall()] if objective_ids else []

    analyses = {task["id"]: effective_analysis(conn, task["id"]) for task in user_tasks}

    completed_tasks = [task for task in user_tasks if task["currentStatus"] in {"completed", "launched"}]
    cross_month_tasks = [task for task in user_tasks if task["isCrossMonth"] and task["currentStatus"] not in {"completed", "launched", "cancelled"}]
    active_tasks = [task for task in user_tasks if task["currentStatus"] not in {"completed", "launched", "cancelled"}]
    planned_tasks = [task for task in user_tasks if task["plannedCompleteDate"] and task["plannedCompleteDate"].startswith(report_month)]
    planned_count = len(planned_tasks)
    completion_rate = round((len(completed_tasks) / planned_count) * 100, 1) if planned_count else 0
    launch_rate = round((sum(1 for task in completed_tasks if task["currentStatus"] == "launched") / len(completed_tasks)) * 100, 1) if completed_tasks else 0

    all_abilities = []
    all_values = []
    all_risks = []
    for analysis in analyses.values():
        if not analysis:
            continue
        all_abilities.extend(analysis["abilityTags"])
        all_values.extend(analysis["valueTypes"])
        all_risks.extend(analysis["riskTypes"])

    result_task_map = defaultdict(list)
    for task in user_tasks:
        result_task_map[task["resultId"]].append(task)

    objective_progress = [objective_progress_summary(objective, [item for item in result_rows if item["objectiveId"] == objective["id"]]) for objective in objective_rows]
    result_progress = [result_progress_summary(result, result_task_map.get(result["id"], [])) for result in result_rows]

    ai_generated_content = {
        "core_work": [task["title"] for task in user_tasks[:5]],
        "objective_progress": objective_progress,
        "result_progress": result_progress,
        "completed_tasks": [{"title": task["title"], "status": task["currentStatus"], "hours": task["totalInputHours"]} for task in completed_tasks],
        "cross_month_tasks": [{"title": task["title"], "status": task["currentStatus"], "hours": task["totalInputHours"]} for task in cross_month_tasks],
        "value_output": sorted(set(all_values)),
        "efficiency_summary": {
            "completionRate": completion_rate,
            "launchRate": launch_rate,
            "totalInputHours": round(sum(task["totalInputHours"] for task in user_tasks), 2),
            "abnormalTasks": [task["title"] for task in active_tasks if analyses.get(task["id"]) and analyses[task["id"]]["riskLevel"] in {"medium", "high"}],
        },
        "ability_growth": sorted(set(all_abilities)),
        "risks": sorted(set(all_risks)),
        "next_month_focus": [task["title"] for task in active_tasks[:5]],
        "narrative": (
            f"{user['name']} 本月围绕 {len(objective_rows)} 个目标、{len(result_rows)} 个成果推进了 {len(user_tasks)} 条事项。"
            f" 当前完成率 {completion_rate}%，上线/交付率 {launch_rate}%。"
        ),
    }

    report_id = make_id("report")
    existing = conn.execute(
        "SELECT id, created_at FROM monthly_reports WHERE report_month = ? AND user_id = ?",
        (report_month, user_id),
    ).fetchone()
    ts = now_iso()
    if existing:
        report_id = existing["id"]
        conn.execute(
            """
            UPDATE monthly_reports
            SET department = ?, objective_ids_json = ?, result_ids_json = ?, task_ids_json = ?,
                report_status = ?, ai_generated_content_json = ?, generated_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                user["department"],
                to_json(objective_ids),
                to_json(result_ids),
                to_json([task["id"] for task in user_tasks]),
                "supervisor_review",
                to_json(ai_generated_content),
                ts,
                ts,
                report_id,
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO monthly_reports (
              id, report_month, user_id, department, objective_ids_json, result_ids_json, task_ids_json,
              report_status, ai_generated_content_json, employee_supplement_json, supervisor_comment,
              final_content_json, generated_at, confirmed_by, confirmed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
            """,
            (
                report_id,
                report_month,
                user_id,
                user["department"],
                to_json(objective_ids),
                to_json(result_ids),
                to_json([task["id"] for task in user_tasks]),
                "supervisor_review",
                to_json(ai_generated_content),
                to_json({}),
                "",
                to_json({}),
                ts,
                ts,
                ts,
            ),
        )

    report_row = conn.execute("SELECT * FROM monthly_reports WHERE id = ?", (report_id,)).fetchone()
    return serialize_report(report_row)


def build_dashboard(conn: sqlite3.Connection, report_month: str) -> dict:
    objectives = [serialize_objective(row) for row in conn.execute("SELECT * FROM objectives ORDER BY created_at DESC").fetchall()]
    results = [serialize_result(row) for row in conn.execute("SELECT * FROM results ORDER BY created_at DESC").fetchall()]
    tasks = tasks_for_month(conn, report_month)
    users = [serialize_user(row) for row in conn.execute("SELECT * FROM users WHERE status = 'active' ORDER BY name").fetchall()]
    analyses = {task["id"]: effective_analysis(conn, task["id"]) for task in tasks}

    planned_tasks = [task for task in tasks if task["plannedCompleteDate"] and task["plannedCompleteDate"].startswith(report_month)]
    completed_tasks = [task for task in tasks if task["currentStatus"] in {"completed", "launched"}]
    launched_tasks = [task for task in tasks if task["currentStatus"] == "launched"]
    cross_month_tasks = [task for task in tasks if task["isCrossMonth"]]
    blocked_tasks = [task for task in tasks if task["currentStatus"] in {"waiting", "paused"}]
    risk_tasks = [task for task in tasks if analyses.get(task["id"]) and analyses[task["id"]]["riskLevel"] in {"medium", "high"}]
    high_value = [task for task in tasks if analyses.get(task["id"]) and analyses[task["id"]]["valueLevel"] in {"V4", "V5"}]
    completion_rate = round((len(completed_tasks) / len(planned_tasks)) * 100, 1) if planned_tasks else 0
    launch_rate = round((len(launched_tasks) / len(completed_tasks)) * 100, 1) if completed_tasks else 0

    objective_board = []
    for objective in objectives:
        objective_results = [result for result in results if result["objectiveId"] == objective["id"]]
        objective_board.append(objective_progress_summary(objective, objective_results))

    result_board = []
    result_task_map = defaultdict(list)
    for task in tasks:
        result_task_map[task["resultId"]].append(task)
    for result in results:
        summary = result_progress_summary(result, result_task_map.get(result["id"], []))
        summary["riskCount"] = sum(
            1 for task in result_task_map.get(result["id"], [])
            if analyses.get(task["id"]) and analyses[task["id"]]["riskLevel"] in {"medium", "high"}
        )
        result_board.append(summary)

    people_board = []
    for user in users:
        if ROLE_EMPLOYEE not in user["roles"]:
            continue
        user_tasks = [task for task in tasks if task["ownerId"] == user["id"]]
        user_completed = [task for task in user_tasks if task["currentStatus"] in {"completed", "launched"}]
        user_launched = [task for task in user_tasks if task["currentStatus"] == "launched"]
        user_planned = [task for task in user_tasks if task["plannedCompleteDate"] and task["plannedCompleteDate"].startswith(report_month)]
        ability_set = set()
        risk_level = "low"
        for task in user_tasks:
            analysis = analyses.get(task["id"])
            if not analysis:
                continue
            ability_set.update(analysis["abilityTags"])
            if analysis["riskLevel"] == "high":
                risk_level = "high"
            elif analysis["riskLevel"] == "medium" and risk_level != "high":
                risk_level = "medium"
        people_board.append(
            {
                "userId": user["id"],
                "name": user["name"],
                "taskCount": len(user_tasks),
                "completionRate": round((len(user_completed) / len(user_planned)) * 100, 1) if user_planned else 0,
                "launchRate": round((len(user_launched) / len(user_completed)) * 100, 1) if user_completed else 0,
                "abilityTags": sorted(ability_set),
                "riskLevel": risk_level,
                "resultCount": len({task["resultId"] for task in user_tasks}),
            }
        )

    risk_board = defaultdict(int)
    value_board = defaultdict(int)
    for analysis in analyses.values():
        if not analysis:
            continue
        for risk in analysis["riskTypes"]:
            risk_board[risk] += 1
        value_board[analysis["valueLevel"]] += 1

    return {
        "metrics": {
            "objectiveCount": len(objectives),
            "resultCount": len(results),
            "taskCount": len(tasks),
            "completionRate": completion_rate,
            "launchRate": launch_rate,
            "crossMonthCount": len(cross_month_tasks),
            "blockedCount": len(blocked_tasks),
            "highValueCount": len(high_value),
            "riskTaskCount": len(risk_tasks),
        },
        "objectiveBoard": objective_board,
        "resultBoard": result_board,
        "peopleBoard": people_board,
        "riskBoard": [{"riskType": key, "count": value} for key, value in sorted(risk_board.items(), key=lambda item: item[1], reverse=True)],
        "valueBoard": [{"valueLevel": key, "count": value} for key, value in sorted(value_board.items()) if key],
    }


def bootstrap_payload(conn: sqlite3.Connection, handler, report_month: str) -> dict:
    viewer = get_viewer(conn, handler)
    users = [serialize_user(row) for row in conn.execute("SELECT * FROM users ORDER BY name").fetchall()]
    setup_required = len(users) == 0
    objectives = [serialize_objective(row) for row in conn.execute("SELECT * FROM objectives ORDER BY created_at DESC").fetchall()]
    results = [serialize_result(row) for row in conn.execute("SELECT * FROM results ORDER BY created_at DESC").fetchall()]
    tasks = [serialize_task(row) for row in conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC").fetchall()]
    progress = [serialize_progress(row) for row in conn.execute("SELECT * FROM task_progress ORDER BY created_at DESC").fetchall()]
    analyses = [serialize_analysis(row) for row in conn.execute("SELECT * FROM ai_analysis ORDER BY created_at DESC").fetchall()]
    reviews = [serialize_review(row) for row in conn.execute("SELECT * FROM manager_reviews ORDER BY created_at DESC").fetchall()]
    reports = [serialize_report(row) for row in conn.execute("SELECT * FROM monthly_reports ORDER BY report_month DESC, generated_at DESC").fetchall()]
    dashboard = build_dashboard(conn, report_month)

    pending_reviews = []
    for analysis in analyses:
        latest_review = next((review for review in reviews if review["aiAnalysisId"] == analysis["id"]), None)
        if analysis["needsManagerReview"] and (not latest_review or latest_review["reviewStatus"] == "pending"):
            pending_reviews.append(analysis)

    return {
        "setupRequired": setup_required,
        "viewer": serialize_user(viewer) if viewer else None,
        "reportMonth": report_month,
        "users": users,
        "objectives": objectives,
        "results": results,
        "tasks": tasks,
        "taskProgress": progress,
        "aiAnalysis": analyses,
        "managerReviews": reviews,
        "pendingReviews": pending_reviews,
        "monthlyReports": reports,
        "dashboard": dashboard,
    }


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Viewer-Id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/bootstrap":
            with get_connection() as conn:
                month = parse_qs(parsed.query).get("month", [month_string()])[0]
                return self.send_json(bootstrap_payload(conn, self, month))
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/system/init":
            return self.handle_system_init()
        if parsed.path == "/api/users":
            return self.handle_create_user()
        if parsed.path == "/api/objectives":
            return self.handle_create_objective()
        if parsed.path == "/api/results":
            return self.handle_create_result()
        if parsed.path == "/api/tasks":
            return self.handle_create_task()
        if parsed.path.startswith("/api/tasks/") and parsed.path.endswith("/progress"):
            task_id = parsed.path.split("/")[3]
            return self.handle_add_progress(task_id)
        if parsed.path == "/api/reviews":
            return self.handle_create_review()
        if parsed.path == "/api/reports/generate":
            return self.handle_generate_reports()
        if parsed.path == "/api/system/reset":
            return self.handle_reset_system()
        if parsed.path == "/api/seed-demo":
            return self.handle_seed_demo()
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else ""
        return json.loads(body) if body else {}

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def handle_create_objective(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN})
            if viewer is None:
                return
            if not payload.get("name") or not payload.get("description") or not payload.get("ownerId"):
                return self.send_json({"error": "目标名称、说明和负责人必填。"}, HTTPStatus.BAD_REQUEST)
            status = ensure_status(payload.get("status", "not_started"), OBJECTIVE_STATUSES, "not_started")
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO objectives (
                  id, name, description, source_type, source_department, source_detail,
                  success_criteria_json, owner_id, participant_ids_json, start_date,
                  due_date, status, out_of_scope_json, ai_summary, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    make_id("obj"),
                    payload["name"].strip(),
                    payload["description"].strip(),
                    payload.get("sourceType", "manager_assigned").strip() or "manager_assigned",
                    payload.get("sourceDepartment", "").strip() or None,
                    payload.get("sourceDetail", "").strip() or None,
                    to_json(payload.get("successCriteria", [])),
                    payload["ownerId"].strip(),
                    to_json(payload.get("participantIds", [])),
                    payload.get("startDate") or datetime.now().strftime("%Y-%m-%d"),
                    payload.get("dueDate") or datetime.now().strftime("%Y-%m-%d"),
                    status,
                    to_json(payload.get("outOfScope", [])),
                    "",
                    viewer["id"],
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True}, HTTPStatus.CREATED)

    def handle_create_user(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN})
            if viewer is None:
                return
            name = (payload.get("name") or "").strip()
            roles = normalize_roles(payload.get("roles") or payload.get("role"))
            position = (payload.get("position") or "").strip()
            department = (payload.get("department") or "AI部").strip() or "AI部"
            if not name:
                return self.send_json({"error": "成员姓名不能为空。"}, HTTPStatus.BAD_REQUEST)
            ts = now_iso()
            user_id = make_id("user")
            conn.execute(
                """
                INSERT INTO users (id, name, department, roles_json, position, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
                """,
                (
                    user_id,
                    name,
                    department,
                    to_json(roles),
                    position or " / ".join(roles),
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True, "userId": user_id}, HTTPStatus.CREATED)

    def handle_system_init(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            total = conn.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
            if total > 0:
                return self.send_json({"error": "系统已经初始化，请使用成员管理继续新增。"}, HTTPStatus.BAD_REQUEST)
            name = (payload.get("name") or "").strip()
            position = (payload.get("position") or "").strip()
            department = (payload.get("department") or "AI部").strip() or "AI部"
            roles = normalize_roles(payload.get("roles") or [ROLE_ADMIN])
            if ROLE_ADMIN not in roles:
                roles.insert(0, ROLE_ADMIN)
            if not name:
                return self.send_json({"error": "请先填写真实管理员姓名。"}, HTTPStatus.BAD_REQUEST)
            ts = now_iso()
            user_id = make_id("user")
            conn.execute(
                """
                INSERT INTO users (id, name, department, roles_json, position, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
                """,
                (
                    user_id,
                    name,
                    department,
                    to_json(roles),
                    position or "AI部门管理员",
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True, "viewerId": user_id}, HTTPStatus.CREATED)

    def handle_create_result(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_EMPLOYEE})
            if viewer is None:
                return
            if not payload.get("objectiveId") or not payload.get("name") or not payload.get("ownerId"):
                return self.send_json({"error": "成果必须关联目标，并填写名称和负责人。"}, HTTPStatus.BAD_REQUEST)
            stage = ensure_status(payload.get("stage", "planning"), RESULT_STAGES, "planning")
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO results (
                  id, objective_id, name, description, completion_criteria_json, expected_value, owner_id,
                  participant_ids_json, stage, due_date, actual_completed_at, actual_launched_at,
                  is_organization_asset, asset_confirmed_by, ai_value_summary, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?, ?)
                """,
                (
                    make_id("res"),
                    payload["objectiveId"].strip(),
                    payload["name"].strip(),
                    payload.get("description", "").strip(),
                    to_json(payload.get("completionCriteria", [])),
                    payload.get("expectedValue", "").strip(),
                    payload["ownerId"].strip(),
                    to_json(payload.get("participantIds", [])),
                    stage,
                    payload.get("dueDate") or datetime.now().strftime("%Y-%m-%d"),
                    viewer["id"],
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True}, HTTPStatus.CREATED)

    def handle_create_task(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_EMPLOYEE})
            if viewer is None:
                return
            if not payload.get("resultId") or not payload.get("ownerId") or not payload.get("title") or not payload.get("content"):
                return self.send_json({"error": "事项必须关联成果，并填写名称、内容和负责人。"}, HTTPStatus.BAD_REQUEST)
            result = conn.execute("SELECT * FROM results WHERE id = ?", (payload["resultId"],)).fetchone()
            if result is None:
                return self.send_json({"error": "未找到关联成果。"}, HTTPStatus.BAD_REQUEST)
            status = ensure_status(payload.get("currentStatus", "developing"), TASK_STATUSES, "developing")
            blocker_reason = payload.get("blockerReason", "").strip()
            if blocker_reason and blocker_reason not in BLOCKER_REASONS:
                blocker_reason = "other"
            ts = now_iso()
            task_id = make_id("task")
            hours = float(payload.get("firstInputHours") or 0)
            conn.execute(
                """
                INSERT INTO tasks (
                  id, result_id, objective_id, owner_id, title, content, current_status, first_input_hours,
                  total_input_hours, planned_complete_date, completed_at, launched_at, last_progress_at,
                  progress_count, blocker_reason, issue_description, is_cross_month, is_delayed,
                  created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, 0, 0, ?, ?, ?)
                """,
                (
                    task_id,
                    payload["resultId"].strip(),
                    result["objective_id"],
                    payload["ownerId"].strip(),
                    payload["title"].strip(),
                    payload["content"].strip(),
                    status,
                    hours,
                    0,
                    payload.get("plannedCompleteDate"),
                    ts,
                    blocker_reason or None,
                    payload.get("issueDescription", "").strip() or None,
                    viewer["id"],
                    ts,
                    ts,
                ),
            )
            conn.execute(
                """
                INSERT INTO task_progress (
                  id, task_id, progress_content, input_hours, status_after_update, issue_description,
                  blocker_reason, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    make_id("prog"),
                    task_id,
                    payload["content"].strip(),
                    hours,
                    status,
                    payload.get("issueDescription", "").strip() or None,
                    blocker_reason or None,
                    viewer["id"],
                    ts,
                ),
            )
            refresh_task_rollups(conn, task_id)
            upsert_task_analysis(conn, task_id)
        self.send_json({"ok": True, "taskId": task_id}, HTTPStatus.CREATED)

    def handle_add_progress(self, task_id: str) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_EMPLOYEE})
            if viewer is None:
                return
            task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if task is None:
                return self.send_json({"error": "事项不存在。"}, HTTPStatus.NOT_FOUND)
            status = ensure_status(payload.get("statusAfterUpdate", "developing"), TASK_STATUSES, "developing")
            blocker_reason = payload.get("blockerReason", "").strip()
            if blocker_reason and blocker_reason not in BLOCKER_REASONS:
                blocker_reason = "other"
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO task_progress (
                  id, task_id, progress_content, input_hours, status_after_update, issue_description,
                  blocker_reason, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    make_id("prog"),
                    task_id,
                    payload.get("progressContent", "").strip(),
                    float(payload.get("inputHours") or 0),
                    status,
                    payload.get("issueDescription", "").strip() or None,
                    blocker_reason or None,
                    viewer["id"],
                    ts,
                ),
            )
            refresh_task_rollups(conn, task_id)
            upsert_task_analysis(conn, task_id)
        self.send_json({"ok": True}, HTTPStatus.CREATED)

    def handle_create_review(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_SUPERVISOR, ROLE_ADMIN})
            if viewer is None:
                return
            analysis_id = payload.get("aiAnalysisId", "").strip()
            analysis = conn.execute("SELECT * FROM ai_analysis WHERE id = ?", (analysis_id,)).fetchone()
            if analysis is None:
                return self.send_json({"error": "AI分析记录不存在。"}, HTTPStatus.BAD_REQUEST)
            review_status = ensure_status(payload.get("reviewStatus", "confirmed"), REVIEW_STATUSES, "confirmed")
            conn.execute(
                """
                INSERT INTO manager_reviews (
                  id, ai_analysis_id, target_type, target_id, reviewer_id, review_status,
                  corrected_work_category_json, corrected_ability_tags_json, corrected_value_types_json,
                  corrected_value_level, corrected_efficiency, corrected_growth_level,
                  corrected_risk_types_json, corrected_risk_level, comment, next_step_suggestion,
                  marked_for_review, marked_as_asset, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    make_id("review"),
                    analysis_id,
                    analysis["target_type"],
                    analysis["target_id"],
                    viewer["id"],
                    review_status,
                    to_json(payload.get("correctedWorkCategory", [])),
                    to_json(payload.get("correctedAbilityTags", [])),
                    to_json(payload.get("correctedValueTypes", [])),
                    payload.get("correctedValueLevel", "").strip() or None,
                    payload.get("correctedEfficiency", "").strip() or None,
                    payload.get("correctedGrowthLevel", "").strip() or None,
                    to_json(payload.get("correctedRiskTypes", [])),
                    payload.get("correctedRiskLevel", "").strip() or None,
                    payload.get("comment", "").strip() or None,
                    payload.get("nextStepSuggestion", "").strip() or None,
                    1 if payload.get("markedForReview") else 0,
                    1 if payload.get("markedAsAsset") else 0,
                    now_iso(),
                ),
            )
            if payload.get("markedAsAsset") and analysis["target_type"] == "task":
                task = conn.execute("SELECT result_id FROM tasks WHERE id = ?", (analysis["target_id"],)).fetchone()
                if task:
                    conn.execute(
                        "UPDATE results SET is_organization_asset = 1, asset_confirmed_by = ?, updated_at = ? WHERE id = ?",
                        (viewer["id"], now_iso(), task["result_id"]),
                    )
        self.send_json({"ok": True}, HTTPStatus.CREATED)

    def handle_generate_reports(self) -> None:
        payload = self.read_json()
        report_month = payload.get("reportMonth") or month_string()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR})
            if viewer is None:
                return
            employee_rows = conn.execute("SELECT * FROM users ORDER BY name").fetchall()
            report_ids = []
            for row in employee_rows:
                user = serialize_user(row)
                if ROLE_EMPLOYEE not in user["roles"]:
                    continue
                report = generate_report_for_user(conn, user["id"], report_month)
                report_ids.append(report["id"])
            reports = [serialize_report(row) for row in conn.execute(
                "SELECT * FROM monthly_reports WHERE report_month = ? ORDER BY generated_at DESC",
                (report_month,),
            ).fetchall()]
        self.send_json({"ok": True, "reports": reports})

    def handle_seed_demo(self) -> None:
        return self.send_json({"ok": True})

    def handle_reset_system(self) -> None:
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN})
            if viewer is None:
                return
            reset_system_data(conn)
        self.send_json({"ok": True, "viewerId": ""})

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    init_db()
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print("AI部门月报自动化试点已启动")
    print(f"访问地址: http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
