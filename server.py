from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "shared_records.db"
CANONICAL_HOST = os.getenv("CANONICAL_HOST", "maiz.xin").strip().lower()
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Shanghai")
AUTO_REPORT_CHECK_INTERVAL_SECONDS = int(os.getenv("AUTO_REPORT_CHECK_INTERVAL_SECONDS", "3600"))
AUTO_REPORT_LOCK = threading.Lock()
LAST_AUTO_REPORT_MONTH = ""
MANAGER_ACCESS_CODE = os.getenv("MANAGER_ACCESS_CODE", "8888").strip()
MANAGER_ACCESS_CODE_SUFFIX_LENGTH = 4

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
ROLE_RECORD_TYPES = {
    "rpa_project",
    "efficiency_result",
    "rpa_capability",
    "asset_creation",
    "ai_research",
    "requirement_management",
    "other",
}
ALLE_RECORD_TYPE_LABELS = {
    "rpa_project": "影刀项目推进",
    "efficiency_result": "使用效果与效率验证",
    "rpa_capability": "影刀能力学习",
    "asset_creation": "流程与资产沉淀",
    "ai_research": "内容AI与专业工具研究",
    "requirement_management": "需求判断与项目协同",
    "other": "其他",
}
ALLE_PROJECT_STAGES = {
    "requirements_collecting",
    "requirements_confirmed",
    "solution_design",
    "developing",
    "testing",
    "trial",
    "launched",
    "stable",
    "optimizing",
    "paused",
    "terminated",
    "completed",
}

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


def local_now() -> datetime:
    return datetime.now(ZoneInfo(APP_TIMEZONE))


def now_iso() -> str:
    return local_now().isoformat(timespec="seconds")


def month_string(value: str | None = None) -> str:
    dt = datetime.fromisoformat(value) if value else local_now()
    return dt.strftime("%Y-%m")


def previous_month_string(value: str | None = None) -> str:
    dt = datetime.fromisoformat(value) if value else local_now()
    first_day = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous_day = first_day - timedelta(days=1)
    return previous_day.strftime("%Y-%m")


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

            CREATE TABLE IF NOT EXISTS auth_sessions (
              token TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS role_records (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              template_key TEXT NOT NULL,
              record_type TEXT NOT NULL,
              record_date TEXT NOT NULL,
              title TEXT NOT NULL,
              related_project TEXT,
              department TEXT,
              stage TEXT,
              work_hours REAL NOT NULL DEFAULT 0,
              payload_json TEXT NOT NULL,
              evidence_json TEXT NOT NULL,
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
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
    conn.execute("DELETE FROM auth_sessions")
    conn.execute("DELETE FROM role_records")
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
    roles = from_json(row["roles_json"])
    return {
        "id": row["id"],
        "name": row["name"],
        "department": row["department"],
        "roles": roles,
        "position": row["position"] or "",
        "status": row["status"],
        "requiresAuthCode": bool(set(roles).intersection({ROLE_ADMIN, ROLE_SUPERVISOR})),
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


def serialize_role_record(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "templateKey": row["template_key"],
        "recordType": row["record_type"],
        "recordDate": row["record_date"],
        "title": row["title"],
        "relatedProject": row["related_project"] or "",
        "department": row["department"] or "",
        "stage": row["stage"] or "",
        "workHours": float(row["work_hours"] or 0),
        "payload": from_json(row["payload_json"], {}),
        "evidence": from_json(row["evidence_json"], []),
        "createdBy": row["created_by"],
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


def has_any_role(user_row: sqlite3.Row | dict | None, allowed_roles: set[str]) -> bool:
    return bool(set(user_roles(user_row)).intersection(allowed_roles))


def is_manager_viewer(user_row: sqlite3.Row | dict | None) -> bool:
    return has_any_role(user_row, {ROLE_ADMIN, ROLE_SUPERVISOR})


def requested_viewer_id(handler) -> str:
    query = parse_qs(urlparse(handler.path).query)
    return (
        handler.headers.get("X-Viewer-Id")
        or query.get("viewer_id", [""])[0]
        or query.get("viewer", [""])[0]
    ).strip()


def session_token(handler) -> str:
    return (handler.headers.get("X-Session-Token") or "").strip()


def manager_access_code_for_user(user_row: sqlite3.Row | dict) -> str:
    return str(user_row["id"])[-MANAGER_ACCESS_CODE_SUFFIX_LENGTH:]


def valid_manager_access_codes(user_row: sqlite3.Row | dict) -> set[str]:
    codes = {manager_access_code_for_user(user_row)}
    if MANAGER_ACCESS_CODE:
        codes.add(MANAGER_ACCESS_CODE)
    return {code.lower() for code in codes if code}


def create_auth_session(conn: sqlite3.Connection, user_id: str) -> str:
    token = uuid.uuid4().hex
    created_at = local_now()
    expires_at = created_at + timedelta(days=7)
    conn.execute(
        """
        INSERT INTO auth_sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            token,
            user_id,
            created_at.isoformat(timespec="seconds"),
            expires_at.isoformat(timespec="seconds"),
        ),
    )
    return token


def session_viewer(conn: sqlite3.Connection, handler) -> sqlite3.Row | None:
    token = session_token(handler)
    if not token:
        return None
    row = conn.execute(
        """
        SELECT users.*
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token = ?
        """,
        (token,),
    ).fetchone()
    if row is None:
        return None

    expires_at_row = conn.execute(
        "SELECT expires_at FROM auth_sessions WHERE token = ?",
        (token,),
    ).fetchone()
    if expires_at_row is None:
        return None

    expires_at = datetime.fromisoformat(expires_at_row["expires_at"])
    if expires_at < local_now():
        conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
        return None
    return row


def default_viewer(conn: sqlite3.Connection) -> sqlite3.Row | None:
    for row in conn.execute(
        """
        SELECT *
        FROM users
        WHERE status = 'active'
        ORDER BY created_at ASC
        """
    ).fetchall():
        if not is_manager_viewer(row):
            return row
    return conn.execute("SELECT * FROM users ORDER BY created_at ASC LIMIT 1").fetchone()


def get_viewer(conn: sqlite3.Connection, handler) -> sqlite3.Row | None:
    authenticated_viewer = session_viewer(conn, handler)
    if authenticated_viewer is not None:
        return authenticated_viewer

    viewer_id = requested_viewer_id(handler)
    if not viewer_id:
        return default_viewer(conn)
    viewer = conn.execute("SELECT * FROM users WHERE id = ?", (viewer_id,)).fetchone()
    if viewer is not None and not is_manager_viewer(viewer):
        return viewer
    return default_viewer(conn)


def require_role(conn: sqlite3.Connection, handler, roles: set[str]) -> sqlite3.Row | None:
    viewer = get_viewer(conn, handler)
    if viewer is None:
        handler.send_json({"error": "未找到当前用户。"}, HTTPStatus.UNAUTHORIZED)
        return None
    if not has_any_role(viewer, roles):
        handler.send_json({"error": "当前角色没有这个操作权限。"}, HTTPStatus.FORBIDDEN)
        return None
    return viewer


def days_between(start_text: str | None, end_text: str | None = None) -> int:
    if not start_text:
        return 0
    start = datetime.fromisoformat(start_text)
    end = datetime.fromisoformat(end_text) if end_text else local_now()
    if (start.tzinfo is None) != (end.tzinfo is None):
        if start.tzinfo is None:
            start = start.replace(tzinfo=end.tzinfo)
        else:
            end = end.replace(tzinfo=start.tzinfo)
    return max((end - start).days, 0)


def task_span_days(task: dict) -> int:
    return days_between(task["createdAt"], task["launchedAt"] or task["completedAt"] or None)


def is_alle_user(user: dict | sqlite3.Row | None) -> bool:
    if not user:
        return False
    if isinstance(user, sqlite3.Row):
        name = user["name"]
        position = user["position"] or ""
    else:
        name = user.get("name", "")
        position = user.get("position", "")
    return name == "阿勒" or "流程应用" in position or "影刀" in position or "AI应用研究员" in position


def month_matches(date_text: str | None, report_month: str) -> bool:
    return bool(date_text and str(date_text).startswith(report_month))


def normalize_alle_record_payload(payload: dict) -> tuple[dict, str, str, str]:
    record_type = (payload.get("recordType") or payload.get("record_type") or "").strip()
    if record_type not in ROLE_RECORD_TYPES:
        raise ValueError("请选择正确的记录类型。")

    record_date = (payload.get("recordDate") or payload.get("date") or "").strip()
    if not record_date:
        raise ValueError("请填写记录日期。")

    content = dict(payload.get("payload") or {})
    department = (payload.get("department") or content.get("department") or content.get("request_department") or "").strip()
    related_project = (
        payload.get("relatedProject")
        or content.get("project_name")
        or content.get("related_project")
        or ""
    ).strip()
    stage = (
        payload.get("stage")
        or content.get("current_stage")
        or content.get("usage_status")
        or content.get("decision")
        or ""
    ).strip()

    if record_type == "rpa_project":
        if not related_project:
            raise ValueError("影刀项目推进必须填写项目名称。")
        if not (department or content.get("department")):
            raise ValueError("影刀项目推进必须填写所属部门。")
        if stage and stage not in ALLE_PROJECT_STAGES:
            raise ValueError("当前阶段不在允许范围内。")
        title = related_project
    elif record_type == "efficiency_result":
        if not related_project:
            raise ValueError("效率验证必须关联项目名称。")
        title = related_project
        try:
            before = float(content.get("time_before_minutes") or 0)
            after = float(content.get("time_after_minutes") or 0)
            monthly_frequency = float(content.get("monthly_frequency") or 0)
        except (TypeError, ValueError):
            before = after = monthly_frequency = 0
        if before > 0 and monthly_frequency > 0 and before >= after:
            content["estimated_monthly_hours_saved"] = round((before - after) * monthly_frequency / 60, 2)
        else:
            content["estimated_monthly_hours_saved"] = ""
    elif record_type == "rpa_capability":
        title = (content.get("capability_name") or "").strip()
        if not title:
            raise ValueError("能力学习必须填写能力名称。")
    elif record_type == "asset_creation":
        title = (content.get("asset_name") or "").strip()
        if not title:
            raise ValueError("流程资产必须填写资产名称。")
    elif record_type == "ai_research":
        title = (content.get("tool_name") or content.get("scenario") or "").strip()
        if not title:
            raise ValueError("工具研究必须填写工具名或研究场景。")
    elif record_type == "other":
        title = (content.get("title") or content.get("summary") or "").strip()
        if not title:
            raise ValueError("其他记录必须填写标题或摘要。")
    else:
        title = (content.get("request_description") or "").strip()
        if not title:
            raise ValueError("需求判断必须填写需求描述。")

    return content, record_type, title, record_date


def role_records_for_month(conn: sqlite3.Connection, user_id: str, report_month: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT *
        FROM role_records
        WHERE user_id = ? AND record_date LIKE ?
        ORDER BY record_date DESC, created_at DESC
        """,
        (user_id, f"{report_month}%"),
    ).fetchall()
    return [serialize_role_record(row) for row in rows]


def alle_stage_label(stage: str) -> str:
    labels = {
        "requirements_collecting": "需求收集中",
        "requirements_confirmed": "需求已确认",
        "solution_design": "方案设计中",
        "developing": "开发中",
        "testing": "测试中",
        "trial": "业务试用中",
        "launched": "已正式上线",
        "stable": "稳定运行",
        "optimizing": "优化中",
        "paused": "暂停",
        "terminated": "已终止",
        "completed": "已完成",
    }
    return labels.get(stage, stage or "-")


def generate_alle_report_for_user(conn: sqlite3.Connection, user: dict, report_month: str) -> dict:
    records = sorted(
        role_records_for_month(conn, user["id"], report_month),
        key=lambda item: (item["recordDate"], item["createdAt"]),
    )

    def append_unique(target: list, value: str) -> None:
        value = (value or "").strip()
        if value and value not in target:
            target.append(value)

    total_work_hours = round(sum(float(item.get("workHours") or 0) for item in records), 2)
    total_duration_days = len({item["recordDate"] for item in records})
    records_by_type = defaultdict(list)
    for item in records:
        records_by_type[item["recordType"]].append(item)

    project_groups: dict[str, dict] = {}
    for record in records_by_type["rpa_project"]:
        payload = record["payload"]
        project_name = payload.get("project_name") or record["relatedProject"] or record["title"]
        group = project_groups.setdefault(
            project_name,
            {
                "projectName": project_name,
                "department": payload.get("department") or record["department"] or "",
                "projectLevel": payload.get("project_level") or "",
                "businessProblem": payload.get("business_problem") or "",
                "originalProcess": payload.get("original_process") or "",
                "rpaSolution": payload.get("rpa_solution") or "",
                "currentStage": record["stage"] or payload.get("current_stage") or "",
                "progressPercent": int(payload.get("progress_percent") or 0),
                "expectedCompletionDate": payload.get("expected_completion_date") or "",
                "completedToday": [],
                "currentResults": [],
                "problems": [],
                "nextActions": [],
                "evidence": [],
                "timeline": [],
                "workHours": 0,
                "isLaunched": False,
                "hasEfficiencyResult": False,
                "hasAsset": False,
            },
        )
        group["department"] = group["department"] or payload.get("department") or record["department"] or ""
        group["projectLevel"] = group["projectLevel"] or payload.get("project_level") or ""
        group["businessProblem"] = group["businessProblem"] or payload.get("business_problem") or ""
        group["originalProcess"] = group["originalProcess"] or payload.get("original_process") or ""
        group["rpaSolution"] = group["rpaSolution"] or payload.get("rpa_solution") or ""
        group["expectedCompletionDate"] = payload.get("expected_completion_date") or group["expectedCompletionDate"]
        group["currentStage"] = record["stage"] or payload.get("current_stage") or group["currentStage"]
        group["progressPercent"] = max(group["progressPercent"], int(payload.get("progress_percent") or 0))
        group["workHours"] += float(record.get("workHours") or 0)
        if group["currentStage"] in {"launched", "stable", "completed"}:
            group["isLaunched"] = True
        for source_key, target_key in [
            ("work_completed_today", "completedToday"),
            ("current_result", "currentResults"),
            ("problem_or_risk", "problems"),
            ("next_action", "nextActions"),
        ]:
            append_unique(group[target_key], payload.get(source_key) or "")
        for link in payload.get("evidence") or record.get("evidence") or []:
            append_unique(group["evidence"], link)
        group["timeline"].append(
            {
                "recordId": record["id"],
                "recordDate": record["recordDate"],
                "stage": group["currentStage"],
                "stageLabel": alle_stage_label(group["currentStage"]),
                "progressPercent": int(payload.get("progress_percent") or 0),
                "workHours": float(record.get("workHours") or 0),
                "completedToday": payload.get("work_completed_today") or "",
                "currentResult": payload.get("current_result") or "",
                "problemOrRisk": payload.get("problem_or_risk") or "",
                "nextAction": payload.get("next_action") or "",
            }
        )

    efficiency_rows = []
    monthly_saved_total = 0.0
    covered_departments = set()
    covered_users = 0
    stable_count = 0
    trial_count = 0
    launched_count = 0
    for record in records_by_type["efficiency_result"]:
        payload = record["payload"]
        project_name = payload.get("project_name") or record["relatedProject"] or record["title"]
        saved_hours = payload.get("estimated_monthly_hours_saved")
        saved_hours_text = "当前尚未形成完整量化数据"
        if saved_hours not in ("", None):
            try:
                saved_value = float(saved_hours)
                monthly_saved_total += saved_value
                saved_hours_text = f"{saved_value:.2f}"
            except (TypeError, ValueError):
                saved_value = None
        usage_status = payload.get("usage_status") or record["stage"] or ""
        if usage_status == "稳定使用":
            stable_count += 1
        elif usage_status == "试用中":
            trial_count += 1
        elif usage_status in {"部分使用", "稳定使用"}:
            launched_count += 1
        department = payload.get("department") or record["department"] or ""
        if department:
            covered_departments.add(department)
        covered_users += int(payload.get("users_count") or 0)
        if project_name in project_groups:
            project_groups[project_name]["hasEfficiencyResult"] = True
            if usage_status in {"部分使用", "稳定使用"}:
                project_groups[project_name]["isLaunched"] = True
        efficiency_rows.append(
            {
                "project": project_name,
                "department": department or "-",
                "usageStatus": usage_status or "-",
                "timeBefore": payload.get("time_before_minutes") or "-",
                "timeAfter": payload.get("time_after_minutes") or "-",
                "monthlyFrequency": payload.get("monthly_frequency") or "-",
                "savedHours": saved_hours_text,
                "businessValue": payload.get("business_value") or "暂无补充",
                "userFeedback": payload.get("user_feedback") or "",
                "remainingProblem": payload.get("remaining_problem") or "",
                "usersCount": int(payload.get("users_count") or 0),
            }
        )

    capability_rows = []
    for record in records_by_type["rpa_capability"]:
        payload = record["payload"]
        related_project = payload.get("related_project") or record["relatedProject"] or ""
        row = {
            "capabilityName": payload.get("capability_name") or record["title"],
            "learningReason": payload.get("learning_reason") or "",
            "relatedProject": related_project,
            "learned": payload.get("what_was_learned") or "",
            "testResult": payload.get("test_result") or "",
            "businessApplication": payload.get("business_application") or "",
            "moduleCreated": bool(payload.get("reusable_module_created")),
            "moduleName": payload.get("reusable_module_name") or "",
            "documentLink": payload.get("document_link") or "",
            "nextStep": payload.get("next_step") or "",
        }
        row["isValidOutcome"] = any(
            [
                row["relatedProject"],
                row["testResult"],
                row["moduleCreated"],
                row["documentLink"],
                row["businessApplication"],
            ]
        )
        capability_rows.append(row)

    asset_rows = []
    for record in records_by_type["asset_creation"]:
        payload = record["payload"]
        related_project = payload.get("related_project") or record["relatedProject"] or ""
        if related_project in project_groups:
            project_groups[related_project]["hasAsset"] = True
        asset_rows.append(
            {
                "assetName": payload.get("asset_name") or record["title"],
                "assetType": payload.get("asset_type") or "",
                "relatedProject": related_project,
                "reusable": bool(payload.get("reusable", True)),
                "usageScope": payload.get("usage_scope") or "",
                "storageLocation": payload.get("storage_location") or "",
                "description": payload.get("asset_description") or "",
                "usersOrDepartments": payload.get("users_or_departments") or "",
                "version": payload.get("version") or "",
                "maintenanceNote": payload.get("maintenance_note") or "",
            }
        )

    research_rows = []
    for record in records_by_type["ai_research"]:
        payload = record["payload"]
        research_rows.append(
            {
                "researchType": payload.get("research_type") or "",
                "scenario": payload.get("scenario") or "",
                "department": payload.get("department") or record["department"] or "",
                "toolName": payload.get("tool_name") or record["title"],
                "problemToSolve": payload.get("problem_to_solve") or "",
                "inputRequirement": payload.get("input_requirement") or "",
                "promptOrMethod": payload.get("prompt_or_method") or "",
                "outputResult": payload.get("output_result") or "",
                "manualCheckPoints": payload.get("manual_check_points") or "",
                "applicableScope": payload.get("applicable_scope") or "",
                "notApplicableScope": payload.get("not_applicable_scope") or "",
                "cost": payload.get("cost") or "",
                "researchConclusion": payload.get("research_conclusion") or "",
                "recommendedAction": payload.get("recommended_action") or "",
                "documentLink": payload.get("document_link") or "",
            }
        )

    other_rows = []
    for record in records_by_type["other"]:
        payload = record["payload"]
        other_rows.append(
            {
                "title": payload.get("title") or record["title"],
                "department": payload.get("department") or record["department"] or "",
                "relatedProject": payload.get("related_project") or record["project"] or "",
                "summary": payload.get("summary") or "",
                "detail": payload.get("detail") or "",
                "businessValue": payload.get("business_value") or "",
                "nextAction": payload.get("next_action") or "",
            }
        )

    requirement_rows = []
    decision_counter = Counter()
    for record in records_by_type["requirement_management"]:
        payload = record["payload"]
        decision = payload.get("decision") or record["stage"] or ""
        if decision:
            decision_counter[decision] += 1
        requirement_rows.append(
            {
                "requestDepartment": payload.get("request_department") or record["department"] or "",
                "requestDescription": payload.get("request_description") or record["title"],
                "realBusinessProblem": payload.get("real_business_problem") or "",
                "isSuitableForAi": "是" if payload.get("is_suitable_for_ai", True) else "否",
                "isSuitableForRpa": "是" if payload.get("is_suitable_for_rpa", True) else "否",
                "recommendedSolution": payload.get("recommended_solution") or "",
                "estimatedValue": payload.get("estimated_value") or "",
                "estimatedDifficulty": payload.get("estimated_difficulty") or "",
                "estimatedWorkload": payload.get("estimated_workload") or "",
                "priority": payload.get("priority") or "",
                "decision": decision or "-",
                "reason": payload.get("reason") or "",
                "communicationResult": payload.get("communication_result") or "",
                "risk": payload.get("risk") or "",
                "nextAction": payload.get("next_action") or "",
            }
        )

    risk_rows = []
    seen_risks = set()
    for record in records:
        payload = record["payload"]
        risk_text = (
            payload.get("problem_or_risk")
            or payload.get("remaining_problem")
            or payload.get("risk")
            or payload.get("maintenance_note")
            or ""
        ).strip()
        if not risk_text or risk_text in seen_risks:
            continue
        seen_risks.add(risk_text)
        impact = payload.get("business_value") or payload.get("current_result") or payload.get("communication_result") or "待进一步确认影响"
        action = payload.get("next_action") or payload.get("recommended_action") or payload.get("maintenance_note") or "持续跟进中"
        due = payload.get("expected_completion_date") or ""
        category = "项目稳定性问题"
        if "权限" in risk_text or "账号" in risk_text:
            category = "权限和账号问题"
        elif "数据" in risk_text:
            category = "数据问题"
        elif "部门" in risk_text or "协同" in risk_text:
            category = "部门协同问题"
        elif "规则" in risk_text:
            category = "业务规则问题"
        elif "费用" in risk_text or "成本" in risk_text:
            category = "工具费用问题"
        risk_rows.append(
            {
                "category": category,
                "problem": risk_text,
                "impact": impact,
                "action": action,
                "needSupport": payload.get("request_department") or payload.get("department") or "",
                "due": due or "未明确",
            }
        )

    next_plan_rows = []
    for group in project_groups.values():
        if group["currentStage"] not in {"completed", "stable", "terminated"}:
            next_plan_rows.append(
                {
                    "priority": "核心影刀项目",
                    "item": group["projectName"],
                    "targetResult": "推进至下一阶段并完成当月关键交付",
                    "milestone": group["expectedCompletionDate"] or "待补充",
                    "acceptance": "阶段状态更新、业务反馈明确、关键问题关闭",
                }
            )
    for row in requirement_rows:
        if row["decision"] in {"进入项目池", "继续调研"}:
            next_plan_rows.append(
                {
                    "priority": "需求推进",
                    "item": row["requestDescription"],
                    "targetResult": row["recommendedSolution"] or "完成需求判断与方案确认",
                    "milestone": row["nextAction"] or "待补充",
                    "acceptance": "完成部门沟通并形成明确处理结论",
                }
            )
    for row in research_rows[:3]:
        next_plan_rows.append(
            {
                "priority": "内容AI及专业工具研究",
                "item": row["toolName"] or row["scenario"],
                "targetResult": row["recommendedAction"] or "形成明确的使用建议",
                "milestone": "下月完成测试结论",
                "acceptance": "输出适用范围、人工校核点和结论",
            }
        )
    next_plan_rows = next_plan_rows[:5]

    project_groups_list = sorted(
        project_groups.values(),
        key=lambda item: (
            {"核心项目": 0, "优化项目": 1, "临时支持": 2}.get(item["projectLevel"], 9),
            -item["progressPercent"],
            item["projectName"],
        ),
    )
    for item in project_groups_list:
        item["timeline"] = sorted(item["timeline"], key=lambda row: (row["recordDate"], row["progressPercent"]))

    priority_module_rows = [
        ["影刀重点项目落地", "40%", f"{len(project_groups_list)} 个项目被纳入本月重点推进"],
        ["影刀使用效果与效率验证", "20%", f"{len(efficiency_rows)} 条上线或试用后的验证记录"],
        ["影刀能力与流程资产沉淀", "15%", f"{len(capability_rows)} 项能力学习，{len(asset_rows)} 项流程资产"],
        ["内容AI及专业工具研究", "15%", f"{len(research_rows)} 条研究记录"],
        ["需求理解与项目推进", "10%", f"{len(requirement_rows)} 条需求判断记录"],
    ]

    priority_module_rows.append(["其他工作补充", "5%", f"{len(other_rows)} 条其他补充记录"])

    overview_lines = []
    if project_groups_list:
        key_names = "、".join(item["projectName"] for item in project_groups_list[:3])
        overview_lines.append(f"本月工作主要围绕影刀流程应用展开，重点推进了 {key_names} 等项目。")
    if launched_count > 0:
        overview_lines.append(f"其中已有 {launched_count} 个项目进入部分使用或稳定使用阶段。")
    if efficiency_rows:
        if monthly_saved_total > 0:
            overview_lines.append(f"已形成 {len(efficiency_rows)} 条效率验证记录，当前可量化节省工时约 {monthly_saved_total:.2f} 小时。")
        else:
            overview_lines.append("已开始跟进上线后的使用情况，但当前尚未形成完整量化数据。")
    if asset_rows or capability_rows:
        overview_lines.append(f"同步沉淀了 {len(asset_rows)} 项流程资产，并补充了 {len(capability_rows)} 条能力学习记录。")
    if research_rows:
        overview_lines.append(f"此外围绕内容AI和专业工具完成了 {len(research_rows)} 条研究记录。")
    narrative = "".join(overview_lines) or "本月暂无可用于生成阿勒专属月报的记录，请先补充真实工作记录。"

    suggested_grade = "合格"
    if project_groups_list and (stable_count > 0 or monthly_saved_total >= 8 or len(asset_rows) >= 2):
        suggested_grade = "优秀"
    elif project_groups_list and (launched_count > 0 or trial_count > 0):
        suggested_grade = "良好"
    elif not project_groups_list and not research_rows and not requirement_rows:
        suggested_grade = "待改进"

    employee_view = {
        "workHours": total_work_hours,
        "workProgress": [
            {
                "taskTitle": item["projectName"],
                "status": alle_stage_label(item["currentStage"]),
                "progressCount": len(item["timeline"]),
                "lastProgressAt": item["timeline"][-1]["recordDate"] if item["timeline"] else "",
            }
            for item in project_groups_list
        ],
        "workContentLinks": [
            {
                "recordId": row["id"],
                "taskTitle": row["title"],
                "resultName": ALLE_RECORD_TYPE_LABELS.get(row["recordType"], row["recordType"]),
            }
            for row in records
        ],
        "completedItems": [
            item["projectName"]
            for item in project_groups_list
            if item["currentStage"] in {"completed", "stable", "launched"}
        ] + [item["assetName"] for item in asset_rows],
        "pendingItems": [
            item["projectName"]
            for item in project_groups_list
            if item["currentStage"] not in {"completed", "stable", "terminated"}
        ],
        "totalDurationDays": total_duration_days,
        "totalProgressCount": len(records),
    }

    management_view = {
        "priorityModules": priority_module_rows,
        "overviewMetrics": {
            "recordCount": len(records),
            "projectCount": len(project_groups_list),
            "launchedProjectCount": launched_count,
            "stableProjectCount": stable_count,
            "trialProjectCount": trial_count,
            "savedHoursTotal": round(monthly_saved_total, 2),
            "coveredDepartmentCount": len(covered_departments),
            "coveredUsersCount": covered_users,
        },
        "projectGroups": project_groups_list,
        "efficiencyRows": efficiency_rows,
        "capabilityRows": capability_rows,
        "assetRows": asset_rows,
        "researchRows": research_rows,
        "otherRows": other_rows,
        "requirementRows": requirement_rows,
        "riskRows": risk_rows,
        "nextPlanRows": next_plan_rows,
    }

    full_dimension_table = [
        ["概览", "岗位定位", "角色", "AI流程应用与落地专员"],
        ["概览", "记录总量", "本月记录数", str(len(records))],
        ["概览", "投入情况", "累计工作时长", f"{total_work_hours} 小时"],
        ["概览", "效率结果", "预计节省工时", f"{round(monthly_saved_total, 2)} 小时" if monthly_saved_total else "当前尚未形成完整量化数据"],
    ]
    for item in project_groups_list:
        full_dimension_table.extend(
            [
                ["重点影刀项目", item["projectName"], "所属部门", item["department"] or "-"],
                ["重点影刀项目", item["projectName"], "当前阶段", alle_stage_label(item["currentStage"])],
                ["重点影刀项目", item["projectName"], "项目进度", f'{item["progressPercent"]}%'],
                ["重点影刀项目", item["projectName"], "本月完成", "；".join(item["completedToday"]) or "-"],
                ["重点影刀项目", item["projectName"], "当前问题", "；".join(item["problems"]) or "-"],
                ["重点影刀项目", item["projectName"], "下一步动作", "；".join(item["nextActions"]) or "-"],
            ]
        )
    for item in efficiency_rows:
        full_dimension_table.extend(
            [
                ["效率改善", item["project"], "使用状态", item["usageStatus"]],
                ["效率改善", item["project"], "时间变化", f'原 {item["timeBefore"]} 分钟 / 现 {item["timeAfter"]} 分钟'],
                ["效率改善", item["project"], "量化结果", f'月度频次 {item["monthlyFrequency"]} / 预计节省 {item["savedHours"]} 小时'],
                ["效率改善", item["project"], "业务价值", item["businessValue"] or "-"],
            ]
        )
    for item in asset_rows:
        full_dimension_table.append(["资产沉淀", item["assetName"], item["assetType"] or "资产类型", item["storageLocation"] or item["usageScope"] or "-"])
    for item in capability_rows:
        full_dimension_table.append(["能力成长", item["capabilityName"], item["relatedProject"] or "关联项目", item["testResult"] or item["learned"] or "-"])
    for item in research_rows:
        full_dimension_table.append(["工具研究", item["toolName"], item["scenario"] or item["researchType"] or "研究场景", item["researchConclusion"] or item["recommendedAction"] or "-"])
    for item in requirement_rows:
        full_dimension_table.append(["需求推进", item["requestDescription"], item["decision"] or "处理决定", item["reason"] or item["recommendedSolution"] or "-"])
    for item in risk_rows:
        full_dimension_table.append(["问题风险", item["problem"], item["category"], item["action"] or "-"])
    for item in next_plan_rows:
        full_dimension_table.append(["下月计划", item["item"], item["priority"], f'{item["targetResult"]}；节点：{item["milestone"]}'])

    ai_generated_content = {
        "report_template": "alle_monthly",
        "narrative": narrative,
        "role_title": "AI流程应用与落地专员",
        "core_work": [item["projectName"] for item in project_groups_list[:5]],
        "priority_modules": priority_module_rows,
        "project_groups": project_groups_list,
        "efficiency_rows": efficiency_rows,
        "capability_rows": capability_rows,
        "asset_rows": asset_rows,
        "research_rows": research_rows,
        "other_rows": other_rows,
        "requirement_rows": requirement_rows,
        "risk_rows": risk_rows,
        "next_plan_rows": next_plan_rows,
        "decision_summary": [{"label": key, "count": value} for key, value in decision_counter.items()],
        "efficiency_summary": {
            "completionRate": 0,
            "launchRate": 0,
            "totalInputHours": total_work_hours,
            "totalDurationDays": total_duration_days,
            "totalProgressCount": len(records),
            "launchedProjectCount": launched_count,
            "stableProjectCount": stable_count,
            "trialProjectCount": trial_count,
            "coveredDepartmentCount": len(covered_departments),
            "coveredUsersCount": covered_users,
            "savedHoursTotal": round(monthly_saved_total, 2),
            "abnormalTasks": [item["problem"] for item in risk_rows[:5]],
        },
        "employee_view": employee_view,
        "management_view": management_view,
        "full_dimension_table": full_dimension_table,
        "self_summary": "本月工作继续以影刀项目落地为核心，后续会加强上线效果验证、流程资产沉淀和研究结论输出。",
        "manager_evaluation": "",
        "suggested_grade": suggested_grade,
    }

    report_id = make_id("report")
    existing = conn.execute(
        "SELECT id FROM monthly_reports WHERE report_month = ? AND user_id = ?",
        (report_month, user["id"]),
    ).fetchone()
    ts = now_iso()
    if existing:
        report_id = existing["id"]
        conn.execute(
            """
            UPDATE monthly_reports
            SET department = ?, objective_ids_json = ?, result_ids_json = ?, task_ids_json = ?,
                report_status = ?, ai_generated_content_json = ?, employee_supplement_json = ?,
                supervisor_comment = ?, final_content_json = ?, generated_at = ?,
                confirmed_by = NULL, confirmed_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (
                user["department"],
                to_json([]),
                to_json([]),
                to_json([]),
                "supervisor_review",
                to_json(ai_generated_content),
                to_json({}),
                "",
                to_json({}),
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
                user["id"],
                user["department"],
                to_json([]),
                to_json([]),
                to_json([]),
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
    if is_alle_user(user):
        return generate_alle_report_for_user(conn, user, report_month)

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

    all_work_categories = []
    all_abilities = []
    all_values = []
    all_value_levels = []
    all_efficiencies = []
    all_risks = []
    all_risk_levels = []
    all_growth_levels = []
    review_summaries = []
    task_analysis_table = []
    for analysis in analyses.values():
        if not analysis:
            continue
        all_work_categories.extend(analysis["workCategory"])
        all_abilities.extend(analysis["abilityTags"])
        all_values.extend(analysis["valueTypes"])
        if analysis["valueLevel"]:
            all_value_levels.append(analysis["valueLevel"])
        if analysis["efficiencyJudgement"]:
            all_efficiencies.append(analysis["efficiencyJudgement"])
        all_risks.extend(analysis["riskTypes"])
        if analysis["riskLevel"]:
            all_risk_levels.append(analysis["riskLevel"])
        if analysis["growthLevel"]:
            all_growth_levels.append(analysis["growthLevel"])

        related_task = next((task for task in user_tasks if task["id"] == analysis["targetId"]), None)
        review = analysis.get("review") or {}
        if related_task:
            result_name = next((item["name"] for item in result_rows if item["id"] == related_task["resultId"]), "")
            task_analysis_table.append(
                {
                    "taskTitle": related_task["title"],
                    "resultName": result_name,
                    "status": related_task["currentStatus"],
                    "hours": related_task["totalInputHours"],
                    "durationDays": task_span_days(related_task),
                    "progressCount": related_task["progressCount"],
                    "workCategory": analysis["workCategory"],
                    "abilityTags": analysis["abilityTags"],
                    "valueTypes": analysis["valueTypes"],
                    "valueLevel": analysis["valueLevel"],
                    "efficiencyJudgement": analysis["efficiencyJudgement"],
                    "riskTypes": analysis["riskTypes"],
                    "riskLevel": analysis["riskLevel"],
                    "growthLevel": analysis["growthLevel"],
                    "needsManagerReview": analysis["needsManagerReview"],
                    "reviewStatus": review.get("reviewStatus") or "",
                }
            )

        if review and review["reviewStatus"] in {"confirmed", "corrected"}:
            review_summaries.append(
                {
                    "taskTitle": next((task["title"] for task in user_tasks if task["id"] == analysis["targetId"]), analysis["targetId"]),
                    "reviewStatus": review["reviewStatus"],
                    "valueLevel": analysis["valueLevel"],
                    "efficiency": analysis["efficiencyJudgement"],
                    "riskLevel": analysis["riskLevel"],
                    "comment": review.get("comment") or "",
                    "nextStepSuggestion": review.get("nextStepSuggestion") or "",
                }
            )

    result_task_map = defaultdict(list)
    for task in user_tasks:
        result_task_map[task["resultId"]].append(task)

    objective_progress = [objective_progress_summary(objective, [item for item in result_rows if item["objectiveId"] == objective["id"]]) for objective in objective_rows]
    result_progress = [result_progress_summary(result, result_task_map.get(result["id"], [])) for result in result_rows]
    total_input_hours = round(sum(task["totalInputHours"] for task in user_tasks), 2)
    total_duration_days = round(sum(task_span_days(task) for task in user_tasks), 1)
    total_progress_count = sum(task["progressCount"] for task in user_tasks)

    def counter_rows(values: list[str]) -> list[dict]:
        return [
            {"label": key, "count": count}
            for key, count in Counter(value for value in values if value).most_common()
        ]

    employee_view = {
        "workHours": total_input_hours,
        "workProgress": [
            {
                "taskTitle": task["title"],
                "status": task["currentStatus"],
                "progressCount": task["progressCount"],
                "lastProgressAt": task["lastProgressAt"] or task["updatedAt"],
            }
            for task in user_tasks
        ],
        "workContentLinks": [
            {
                "taskId": task["id"],
                "taskTitle": task["title"],
                "resultName": next((item["name"] for item in result_rows if item["id"] == task["resultId"]), ""),
            }
            for task in user_tasks
        ],
        "completedItems": [task["title"] for task in completed_tasks],
        "pendingItems": [task["title"] for task in active_tasks],
        "totalDurationDays": total_duration_days,
        "totalProgressCount": total_progress_count,
    }

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
            "totalInputHours": total_input_hours,
            "totalDurationDays": total_duration_days,
            "totalProgressCount": total_progress_count,
            "abnormalTasks": [task["title"] for task in active_tasks if analyses.get(task["id"]) and analyses[task["id"]]["riskLevel"] in {"medium", "high"}],
        },
        "ability_growth": sorted(set(all_abilities)),
        "risks": sorted(set(all_risks)),
        "work_categories": counter_rows(all_work_categories),
        "ability_tags_summary": counter_rows(all_abilities),
        "value_types_summary": counter_rows(all_values),
        "value_levels_summary": counter_rows(all_value_levels),
        "efficiency_judgements_summary": counter_rows(all_efficiencies),
        "risk_types_summary": counter_rows(all_risks),
        "risk_levels_summary": counter_rows(all_risk_levels),
        "growth_levels_summary": counter_rows(all_growth_levels),
        "task_analysis_table": task_analysis_table,
        "manager_review_summary": review_summaries,
        "next_month_focus": [task["title"] for task in active_tasks[:5]],
        "employee_view": employee_view,
        "management_view": {
            "workCategories": counter_rows(all_work_categories),
            "abilityTags": counter_rows(all_abilities),
            "valueTypes": counter_rows(all_values),
            "valueLevels": counter_rows(all_value_levels),
            "efficiencyJudgements": counter_rows(all_efficiencies),
            "riskTypes": counter_rows(all_risks),
            "riskLevels": counter_rows(all_risk_levels),
            "growthLevels": counter_rows(all_growth_levels),
            "taskAnalysisTable": task_analysis_table,
            "managerReviewSummary": review_summaries,
        },
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
                report_status = ?, ai_generated_content_json = ?, employee_supplement_json = ?,
                supervisor_comment = ?, final_content_json = ?, generated_at = ?,
                confirmed_by = NULL, confirmed_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (
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


def employee_users(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM users WHERE status = 'active' ORDER BY name").fetchall()
    return [serialize_user(row) for row in rows if ROLE_EMPLOYEE in serialize_user(row)["roles"]]


def users_with_monthly_activity(conn: sqlite3.Connection, report_month: str) -> set[str]:
    return {task["ownerId"] for task in tasks_for_month(conn, report_month)}


def generate_reports_for_month(
    conn: sqlite3.Connection,
    report_month: str,
    *,
    user_ids: set[str] | None = None,
    include_empty: bool = True,
) -> list[dict]:
    employees = employee_users(conn)
    active_user_ids = users_with_monthly_activity(conn, report_month) if not include_empty else set()
    report_ids = []
    for user in employees:
        if user_ids is not None and user["id"] not in user_ids:
            continue
        if not include_empty and user["id"] not in active_user_ids:
            continue
        report = generate_report_for_user(conn, user["id"], report_month)
        report_ids.append(report["id"])
    if not report_ids:
        return []
    return [
        serialize_report(row)
        for row in conn.execute(
            "SELECT * FROM monthly_reports WHERE report_month = ? ORDER BY generated_at DESC",
            (report_month,),
        ).fetchall()
    ]


def ensure_previous_month_reports_generated(reference: datetime | None = None) -> bool:
    global LAST_AUTO_REPORT_MONTH

    now_dt = reference or local_now()
    if now_dt.day != 1:
        return False

    target_month = previous_month_string(now_dt.isoformat())
    current_month_marker = month_string(now_dt.isoformat())

    with AUTO_REPORT_LOCK:
        if LAST_AUTO_REPORT_MONTH == current_month_marker:
            return False

        with get_connection() as conn:
            employees = employee_users(conn)
            if not employees:
                LAST_AUTO_REPORT_MONTH = current_month_marker
                return False

            active_user_ids = users_with_monthly_activity(conn, target_month)
            eligible_user_ids = {user["id"] for user in employees if user["id"] in active_user_ids}
            if not eligible_user_ids:
                LAST_AUTO_REPORT_MONTH = current_month_marker
                return False

            existing_count = conn.execute(
                "SELECT COUNT(*) AS total FROM monthly_reports WHERE report_month = ? AND user_id IN ({})".format(
                    ",".join("?" * len(eligible_user_ids))
                ),
                [target_month, *sorted(eligible_user_ids)],
            ).fetchone()["total"]

            if existing_count >= len(eligible_user_ids):
                LAST_AUTO_REPORT_MONTH = current_month_marker
                return False

            generate_reports_for_month(
                conn,
                target_month,
                user_ids=eligible_user_ids,
                include_empty=False,
            )
            LAST_AUTO_REPORT_MONTH = current_month_marker
            return True


def build_dashboard(conn: sqlite3.Connection, report_month: str) -> dict:
    objectives = [serialize_objective(row) for row in conn.execute("SELECT * FROM objectives ORDER BY created_at DESC").fetchall()]
    results = [serialize_result(row) for row in conn.execute("SELECT * FROM results ORDER BY created_at DESC").fetchall()]
    tasks = tasks_for_month(conn, report_month)
    reports = [
        serialize_report(row)
        for row in conn.execute(
            "SELECT * FROM monthly_reports WHERE report_month = ? ORDER BY generated_at DESC",
            (report_month,),
        ).fetchall()
    ]
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

    employee_users = [user for user in users if ROLE_EMPLOYEE in user["roles"]]
    report_status_board = defaultdict(int)
    pending_report_users = []
    confirmed_report_users = []
    for report in reports:
        report_status_board[report["reportStatus"]] += 1
        owner = next((user for user in employee_users if user["id"] == report["userId"]), None)
        owner_name = owner["name"] if owner else report["userId"]
        if report["reportStatus"] == "supervisor_review":
            pending_report_users.append(owner_name)
        if report["reportStatus"] == "confirmed":
            confirmed_report_users.append(owner_name)

    report_coverage = round((len(reports) / len(employee_users)) * 100, 1) if employee_users else 0

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
            "reportCount": len(reports),
            "reportCoverage": report_coverage,
            "pendingReportCount": report_status_board["supervisor_review"],
            "confirmedReportCount": report_status_board["confirmed"],
        },
        "objectiveBoard": objective_board,
        "resultBoard": result_board,
        "peopleBoard": people_board,
        "riskBoard": [{"riskType": key, "count": value} for key, value in sorted(risk_board.items(), key=lambda item: item[1], reverse=True)],
        "valueBoard": [{"valueLevel": key, "count": value} for key, value in sorted(value_board.items()) if key],
        "reportBoard": {
            "statusCounts": [
                {"status": key, "count": value}
                for key, value in sorted(report_status_board.items(), key=lambda item: item[0])
                if value
            ],
            "pendingUsers": pending_report_users,
            "confirmedUsers": confirmed_report_users,
        },
    }


def filter_payload_for_viewer(payload: dict, viewer: dict | None) -> dict:
    if viewer is None or is_manager_viewer(viewer):
        payload["auth"] = {
            "activeSession": bool(payload.get("viewer")),
            "managerSwitchRule": "主管或管理身份切换需要验证码。",
        }
        return payload

    tasks = [item for item in payload["tasks"] if item["ownerId"] == viewer["id"]]
    task_ids = {item["id"] for item in tasks}
    result_ids = {item["resultId"] for item in tasks}
    objective_ids = {item["objectiveId"] for item in tasks}

    results = [
        item for item in payload["results"]
        if item["ownerId"] == viewer["id"] or item["id"] in result_ids
    ]
    result_ids.update(item["id"] for item in results)
    objective_ids.update(item["objectiveId"] for item in results)

    objectives = [
        item for item in payload["objectives"]
        if item["ownerId"] == viewer["id"] or item["id"] in objective_ids
    ]
    objective_ids.update(item["id"] for item in objectives)

    task_progress = [item for item in payload["taskProgress"] if item["taskId"] in task_ids]
    monthly_reports = [
        item for item in payload["monthlyReports"]
        if item["userId"] == viewer["id"]
    ]
    role_records = [item for item in payload.get("roleRecords", []) if item["userId"] == viewer["id"]]

    payload["objectives"] = objectives
    payload["results"] = results
    payload["tasks"] = tasks
    payload["taskProgress"] = task_progress
    payload["aiAnalysis"] = []
    payload["managerReviews"] = []
    payload["pendingReviews"] = []
    payload["monthlyReports"] = monthly_reports
    payload["roleRecords"] = role_records
    payload["dashboard"] = None
    payload["auth"] = {
        "activeSession": False,
        "managerSwitchRule": "主管或管理身份切换需要验证码。",
    }
    return payload


def bootstrap_payload(conn: sqlite3.Connection, handler, report_month: str) -> dict:
    ensure_previous_month_reports_generated()
    requested_id = requested_viewer_id(handler)
    requested_user = None
    if requested_id:
        requested_user = conn.execute("SELECT * FROM users WHERE id = ?", (requested_id,)).fetchone()
    viewer = get_viewer(conn, handler)
    users = [serialize_user(row) for row in conn.execute("SELECT * FROM users ORDER BY name").fetchall()]
    setup_required = len(users) == 0
    objectives = [serialize_objective(row) for row in conn.execute("SELECT * FROM objectives ORDER BY created_at DESC").fetchall()]
    results = [serialize_result(row) for row in conn.execute("SELECT * FROM results ORDER BY created_at DESC").fetchall()]
    tasks = [serialize_task(row) for row in conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC").fetchall()]
    progress = [serialize_progress(row) for row in conn.execute("SELECT * FROM task_progress ORDER BY created_at DESC").fetchall()]
    analyses = [serialize_analysis(row) for row in conn.execute("SELECT * FROM ai_analysis ORDER BY created_at DESC").fetchall()]
    reviews = [serialize_review(row) for row in conn.execute("SELECT * FROM manager_reviews ORDER BY created_at DESC").fetchall()]
    role_records = [serialize_role_record(row) for row in conn.execute("SELECT * FROM role_records ORDER BY record_date DESC, created_at DESC").fetchall()]
    reports = [
        serialize_report(row)
        for row in conn.execute(
            "SELECT * FROM monthly_reports WHERE report_month = ? ORDER BY generated_at DESC",
            (report_month,),
        ).fetchall()
    ]
    dashboard = build_dashboard(conn, report_month)

    pending_reviews = []
    for analysis in analyses:
        latest_review = next((review for review in reviews if review["aiAnalysisId"] == analysis["id"]), None)
        if analysis["needsManagerReview"] and (not latest_review or latest_review["reviewStatus"] == "pending"):
            pending_reviews.append(analysis)

    payload = {
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
        "roleRecords": role_records,
        "pendingReviews": pending_reviews,
        "monthlyReports": reports,
        "dashboard": dashboard,
    }
    if (
        requested_user is not None
        and is_manager_viewer(requested_user)
        and session_viewer(conn, handler) is None
    ):
        payload["authRequestedViewer"] = serialize_user(requested_user)
    return filter_payload_for_viewer(payload, payload["viewer"])


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def maybe_redirect_to_canonical_host(self) -> bool:
        host_header = (self.headers.get("Host") or "").strip().lower()
        host = host_header.split(":", 1)[0]
        if not CANONICAL_HOST or host != f"www.{CANONICAL_HOST}":
            return False
        target_url = f"https://{CANONICAL_HOST}{self.path}"
        self.send_response(HTTPStatus.MOVED_PERMANENTLY)
        self.send_header("Location", target_url)
        self.end_headers()
        return True

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Viewer-Id, X-Session-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        if self.maybe_redirect_to_canonical_host():
            return
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
        if parsed.path == "/api/auth/switch":
            return self.handle_auth_switch()
        if parsed.path == "/api/users":
            return self.handle_create_user()
        if parsed.path == "/api/objectives":
            return self.handle_create_objective()
        if parsed.path == "/api/results":
            return self.handle_create_result()
        if parsed.path == "/api/role-records":
            return self.handle_create_role_record()
        if parsed.path == "/api/tasks":
            return self.handle_create_task()
        if parsed.path.startswith("/api/tasks/") and parsed.path.endswith("/progress"):
            task_id = parsed.path.split("/")[3]
            return self.handle_add_progress(task_id)
        if parsed.path == "/api/reviews":
            return self.handle_create_review()
        if parsed.path == "/api/reports/generate":
            return self.handle_generate_reports()
        if parsed.path == "/api/reports/confirm":
            return self.handle_confirm_report()
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

    def handle_auth_switch(self) -> None:
        payload = self.read_json()
        user_id = (payload.get("userId") or "").strip()
        access_code = (payload.get("accessCode") or "").strip()
        if not user_id:
            return self.send_json({"error": "请选择需要进入的身份。"}, HTTPStatus.BAD_REQUEST)

        with get_connection() as conn:
            user_row = conn.execute("SELECT * FROM users WHERE id = ? AND status = 'active'", (user_id,)).fetchone()
            if user_row is None:
                return self.send_json({"error": "未找到要切换的身份。"}, HTTPStatus.NOT_FOUND)
            if is_manager_viewer(user_row):
                if access_code.lower() not in valid_manager_access_codes(user_row):
                    return self.send_json(
                        {"error": "主管验证码错误，请重新输入。"},
                        HTTPStatus.FORBIDDEN,
                    )
            token = create_auth_session(conn, user_row["id"])

        self.send_json(
            {
                "ok": True,
                "viewerId": user_row["id"],
                "sessionToken": token,
                "viewer": serialize_user(user_row),
            }
        )

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
            objective_id = make_id("obj")
            conn.execute(
                """
                INSERT INTO objectives (
                  id, name, description, source_type, source_department, source_detail,
                  success_criteria_json, owner_id, participant_ids_json, start_date,
                  due_date, status, out_of_scope_json, ai_summary, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    objective_id,
                    payload["name"].strip(),
                    payload["description"].strip(),
                    payload.get("sourceType", "manager_assigned").strip() or "manager_assigned",
                    payload.get("sourceDepartment", "").strip() or None,
                    payload.get("sourceDetail", "").strip() or None,
                    to_json(payload.get("successCriteria", [])),
                    payload["ownerId"].strip(),
                    to_json(payload.get("participantIds", [])),
                    payload.get("startDate") or local_now().strftime("%Y-%m-%d"),
                    payload.get("dueDate") or local_now().strftime("%Y-%m-%d"),
                    status,
                    to_json(payload.get("outOfScope", [])),
                    "",
                    viewer["id"],
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True, "objectiveId": objective_id}, HTTPStatus.CREATED)

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
            objective = conn.execute("SELECT * FROM objectives WHERE id = ?", (payload["objectiveId"],)).fetchone()
            if objective is None:
                return self.send_json({"error": "未找到关联目标。"}, HTTPStatus.BAD_REQUEST)
            if not is_manager_viewer(viewer):
                if payload["ownerId"].strip() != viewer["id"]:
                    return self.send_json({"error": "普通员工只能为自己创建成果。"}, HTTPStatus.FORBIDDEN)
                if objective["owner_id"] != viewer["id"]:
                    return self.send_json({"error": "普通员工只能在自己的目标下创建成果。"}, HTTPStatus.FORBIDDEN)
            stage = ensure_status(payload.get("stage", "planning"), RESULT_STAGES, "planning")
            ts = now_iso()
            result_id = make_id("res")
            conn.execute(
                """
                INSERT INTO results (
                  id, objective_id, name, description, completion_criteria_json, expected_value, owner_id,
                  participant_ids_json, stage, due_date, actual_completed_at, actual_launched_at,
                  is_organization_asset, asset_confirmed_by, ai_value_summary, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?, ?)
                """,
                (
                    result_id,
                    payload["objectiveId"].strip(),
                    payload["name"].strip(),
                    payload.get("description", "").strip(),
                    to_json(payload.get("completionCriteria", [])),
                    payload.get("expectedValue", "").strip(),
                    payload["ownerId"].strip(),
                    to_json(payload.get("participantIds", [])),
                    stage,
                    payload.get("dueDate") or local_now().strftime("%Y-%m-%d"),
                    viewer["id"],
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True, "resultId": result_id}, HTTPStatus.CREATED)

    def handle_create_role_record(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_EMPLOYEE})
            if viewer is None:
                return
            user_id = (payload.get("userId") or "").strip() or viewer["id"]
            user_row = conn.execute("SELECT * FROM users WHERE id = ? AND status = 'active'", (user_id,)).fetchone()
            if user_row is None:
                return self.send_json({"error": "未找到记录所属成员。"}, HTTPStatus.BAD_REQUEST)
            if not is_manager_viewer(viewer) and user_row["id"] != viewer["id"]:
                return self.send_json({"error": "普通员工只能为自己新增记录。"}, HTTPStatus.FORBIDDEN)
            if not is_alle_user(user_row):
                return self.send_json({"error": "当前专属记录模板仅对阿勒开放。"}, HTTPStatus.BAD_REQUEST)
            try:
                content, record_type, title, record_date = normalize_alle_record_payload(payload)
            except ValueError as error:
                return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

            record_id = make_id("record")
            ts = now_iso()
            work_hours = float(payload.get("workHours") or 0)
            department = (
                payload.get("department")
                or content.get("department")
                or content.get("request_department")
                or user_row["department"]
            )
            related_project = (
                payload.get("relatedProject")
                or content.get("project_name")
                or content.get("related_project")
                or ""
            )
            stage = (
                payload.get("stage")
                or content.get("current_stage")
                or content.get("usage_status")
                or content.get("decision")
                or ""
            )
            conn.execute(
                """
                INSERT INTO role_records (
                  id, user_id, template_key, record_type, record_date, title, related_project,
                  department, stage, work_hours, payload_json, evidence_json, created_by, created_at, updated_at
                ) VALUES (?, ?, 'alle_monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    user_row["id"],
                    record_type,
                    record_date,
                    title,
                    related_project or None,
                    department or None,
                    stage or None,
                    work_hours,
                    to_json(content),
                    to_json(payload.get("evidence") or content.get("evidence") or []),
                    viewer["id"],
                    ts,
                    ts,
                ),
            )
        self.send_json({"ok": True, "recordId": record_id}, HTTPStatus.CREATED)

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
            if not is_manager_viewer(viewer):
                if payload["ownerId"].strip() != viewer["id"]:
                    return self.send_json({"error": "普通员工只能为自己创建事项。"}, HTTPStatus.FORBIDDEN)
                if result["owner_id"] != viewer["id"]:
                    return self.send_json({"error": "普通员工只能在自己的成果下创建事项。"}, HTTPStatus.FORBIDDEN)
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
            if not is_manager_viewer(viewer) and task["owner_id"] != viewer["id"]:
                return self.send_json({"error": "普通员工只能给自己的事项追加进展。"}, HTTPStatus.FORBIDDEN)
            status = ensure_status(payload.get("statusAfterUpdate", "developing"), TASK_STATUSES, "developing")
            blocker_reason = payload.get("blockerReason", "").strip()
            if blocker_reason and blocker_reason not in BLOCKER_REASONS:
                blocker_reason = "other"
            ts = now_iso()
            progress_id = make_id("prog")
            conn.execute(
                """
                INSERT INTO task_progress (
                  id, task_id, progress_content, input_hours, status_after_update, issue_description,
                  blocker_reason, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    progress_id,
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
        self.send_json({"ok": True, "taskId": task_id, "progressId": progress_id}, HTTPStatus.CREATED)

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
            review_id = make_id("review")
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
                    review_id,
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
        self.send_json({"ok": True, "reviewId": review_id, "aiAnalysisId": analysis_id}, HTTPStatus.CREATED)

    def handle_generate_reports(self) -> None:
        payload = self.read_json()
        report_month = payload.get("reportMonth") or month_string()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR})
            if viewer is None:
                return
            reports = generate_reports_for_month(conn, report_month)
        self.send_json({"ok": True, "reports": reports})

    def handle_confirm_report(self) -> None:
        payload = self.read_json()
        with get_connection() as conn:
            viewer = require_role(conn, self, {ROLE_ADMIN, ROLE_SUPERVISOR})
            if viewer is None:
                return

            report_id = payload.get("reportId", "").strip()
            report_row = conn.execute("SELECT * FROM monthly_reports WHERE id = ?", (report_id,)).fetchone()
            if report_row is None:
                return self.send_json({"error": "未找到对应月报。"}, HTTPStatus.NOT_FOUND)

            report = serialize_report(report_row)
            ts = now_iso()
            supervisor_comment = payload.get("supervisorComment", "").strip()
            approved_narrative = payload.get("approvedNarrative", "").strip() or report["aiGeneratedContent"].get("narrative", "")
            manager_evaluation = payload.get("managerEvaluation", "").strip()
            self_summary = payload.get("selfSummary", "").strip() or report["aiGeneratedContent"].get("self_summary", "")
            manager_score = payload.get("managerScore")
            final_content = {
                "approvedNarrative": approved_narrative,
                "supervisorComment": supervisor_comment,
                "managerEvaluation": manager_evaluation,
                "selfSummary": self_summary,
                "managerScore": manager_score,
                "suggestedGrade": report["aiGeneratedContent"].get("suggested_grade", ""),
                "confirmedBy": viewer["id"],
                "confirmedAt": ts,
                "reportMonth": report["reportMonth"],
                "reportTemplate": report["aiGeneratedContent"].get("report_template", ""),
                "employeeView": report["aiGeneratedContent"].get("employee_view", {}),
                "managementView": report["aiGeneratedContent"].get("management_view", {}),
            }
            conn.execute(
                """
                UPDATE monthly_reports
                SET report_status = ?, supervisor_comment = ?, final_content_json = ?,
                    confirmed_by = ?, confirmed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    "confirmed",
                    supervisor_comment,
                    to_json(final_content),
                    viewer["id"],
                    ts,
                    ts,
                    report_id,
                ),
            )
            updated_row = conn.execute("SELECT * FROM monthly_reports WHERE id = ?", (report_id,)).fetchone()

        self.send_json({"ok": True, "report": serialize_report(updated_row)})

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
    ensure_previous_month_reports_generated()

    def auto_report_loop() -> None:
        while True:
            try:
                ensure_previous_month_reports_generated()
            except Exception as error:
                print(f"auto report generation skipped: {error}")
            time.sleep(max(60, AUTO_REPORT_CHECK_INTERVAL_SECONDS))

    threading.Thread(target=auto_report_loop, daemon=True).start()
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print("AI部门月报自动化试点已启动")
    print(f"访问地址: http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
