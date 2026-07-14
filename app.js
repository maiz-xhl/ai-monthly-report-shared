const API_BASE = `${window.location.origin}/api`;
const VIEWER_KEY = "ai-pilot-viewer";
const SESSION_TOKEN_KEY = "ai-pilot-session-token";
const MONTH_KEY = "ai-pilot-month";
const TAB_KEY = "ai-pilot-tab";
const queryParams = new URLSearchParams(window.location.search);
const requestedViewerId = queryParams.get("viewer");
localStorage.removeItem(SESSION_TOKEN_KEY);

const setupPanel = document.getElementById("setupPanel");
const setupForm = document.getElementById("setupForm");
const viewerSelect = document.getElementById("viewerSelect");
const monthInput = document.getElementById("monthInput");
const refreshButton = document.getElementById("refreshButton");
const heroMonth = document.getElementById("heroMonth");
const heroViewer = document.getElementById("heroViewer");
const heroStatus = document.getElementById("heroStatus");
const heroEntryButton = document.getElementById("heroEntryButton");
const viewerCard = document.getElementById("viewerCard");
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authHint = document.getElementById("authHint");
const authCodeInput = document.getElementById("authCodeInput");
const authConfirmButton = document.getElementById("authConfirmButton");
const authCancelButton = document.getElementById("authCancelButton");
const authDismissButton = document.getElementById("authDismissButton");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const objectiveForm = document.getElementById("objectiveForm");
const userForm = document.getElementById("userForm");
const resultForm = document.getElementById("resultForm");
const taskForm = document.getElementById("taskForm");
const progressForm = document.getElementById("progressForm");
const reviewForm = document.getElementById("reviewForm");
const roleRecordForm = document.getElementById("roleRecordForm");
const generateReportsButton = document.getElementById("generateReportsButton");
const resetSystemButton = document.getElementById("resetSystemButton");

const objectiveOwner = document.getElementById("objectiveOwner");
const resultObjective = document.getElementById("resultObjective");
const resultOwner = document.getElementById("resultOwner");
const taskResult = document.getElementById("taskResult");
const taskOwner = document.getElementById("taskOwner");
const progressTask = document.getElementById("progressTask");
const reviewAnalysis = document.getElementById("reviewAnalysis");
const roleRecordOwner = document.getElementById("roleRecordOwner");
const roleRecordType = document.getElementById("roleRecordType");
const roleRecordDate = document.getElementById("roleRecordDate");
const userList = document.getElementById("userList");
const userFeedback = document.getElementById("userFeedback");

let state = {
  viewerId: requestedViewerId || localStorage.getItem(VIEWER_KEY) || "",
  month: localStorage.getItem(MONTH_KEY) || new Date().toISOString().slice(0, 7),
  data: null,
  activeTab: localStorage.getItem(TAB_KEY) || "dashboard",
  loading: false,
  pendingFocus: null,
  selectedReportId: null,
  pendingAuthUserId: null,
};

monthInput.value = state.month;

function ensureRoleRecordTypeOptions() {
  if (!roleRecordType) return;
  const labels = {
    rpa_project: "影刀项目推进",
    efficiency_result: "使用效果与效率验证",
    rpa_capability: "影刀能力学习",
    asset_creation: "流程与资产沉淀",
    ai_research: "内容 AI 与专业工具研究",
    requirement_management: "需求判断与项目协同",
    other: "其他",
  };
  Object.entries(labels).forEach(([value, label]) => {
    let option = roleRecordType.querySelector(`option[value="${value}"]`);
    if (!option) {
      option = document.createElement("option");
      option.value = value;
      roleRecordType.append(option);
    }
    option.textContent = label;
  });
}

ensureRoleRecordTypeOptions();

function ensureRoleRecordFormLabels() {
  if (!roleRecordForm) return;
  const ownerLabel = roleRecordOwner?.closest("label")?.querySelector("span");
  const typeLabel = roleRecordType?.closest("label")?.querySelector("span");
  const dateLabel = roleRecordDate?.closest("label")?.querySelector("span");
  const hoursLabel = roleRecordForm.querySelector('input[name="workHours"]')?.closest("label")?.querySelector("span");
  const evidenceArea = roleRecordForm.querySelector('textarea[name="evidenceText"]');
  const evidenceLabel = evidenceArea?.closest("label")?.querySelector("span");
  if (ownerLabel) ownerLabel.textContent = "记录归属人";
  if (typeLabel) typeLabel.textContent = "记录类型";
  if (dateLabel) dateLabel.textContent = "记录日期";
  if (hoursLabel) hoursLabel.textContent = "本次投入时长（小时）";
  if (evidenceLabel) evidenceLabel.textContent = "附件和成果链接（每行一个）";
  if (evidenceArea) evidenceArea.placeholder = "附件地址、成果页面、文档链接、录屏链接等";
}

ensureRoleRecordFormLabels();

const BUSINESS_VALUE_OPTIONS = [
  "节省人力",
  "提升效率",
  "降低错误率",
  "提升交付稳定性",
  "支撑跨部门协同",
  "沉淀可复用资产",
  "支撑管理决策",
  "提升业务响应速度",
];

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Viewer-Id", state.viewerId);
  const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
  if (sessionToken) {
    headers.set("X-Session-Token", sessionToken);
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

function splitLines(value) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLink(value) {
  const link = String(value || "").trim();
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(link)) return `https://${link}`;
  return "";
}

function checkedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function roleLabel(user) {
  if (!user) return "-";
  const labels = {
    admin: "管理层",
    supervisor: "主管",
    employee: "员工",
    ai_system: "AI系统",
  };
  return user.roles.map((item) => labels[item] || item).join(" / ");
}

function objectiveSourceLabel(sourceType) {
  if (sourceType === "self_initiated") return "自行发起";
  if (sourceType === "cross_department") return "其他部门发起";
  return "部门经理安排";
}

function objectiveStatusLabel(status) {
  const labels = {
    not_started: "未开始",
    in_progress: "进行中",
    at_risk: "有风险",
    completed: "已完成",
    paused: "已暂停",
    cancelled: "已取消",
  };
  return labels[status] || status || "-";
}

function resultStageLabel(stage) {
  const labels = {
    planning: "规划中",
    developing: "开发中",
    debugging: "调试中",
    testing: "测试中",
    launched: "已上线/已交付",
    optimizing: "优化中",
    archived: "已归档",
    paused: "已暂停",
    cancelled: "已取消",
  };
  return labels[stage] || stage || "-";
}

function taskStatusLabel(status) {
  const labels = {
    not_started: "未开始",
    developing: "开发中",
    debugging: "调试中",
    testing: "测试中",
    waiting: "待处理",
    paused: "已暂停",
    completed: "已完成",
    launched: "已上线/已交付",
    cancelled: "已取消",
  };
  return labels[status] || status || "-";
}

function alleStageLabel(stage) {
  const labels = {
    requirements_collecting: "需求收集中",
    requirements_confirmed: "需求已确认",
    solution_design: "方案设计中",
    developing: "开发中",
    testing: "测试中",
    trial: "业务试用中",
    launched: "已正式上线",
    stable: "稳定运行",
    optimizing: "优化中",
    paused: "暂停",
    terminated: "已终止",
    completed: "已完成",
  };
  return labels[stage] || stage || "-";
}

function reportStatusLabel(status) {
  const labels = {
    draft: "草稿",
    employee_review: "员工补充中",
    supervisor_review: "待主管确认",
    confirmed: "已确认",
    exported: "已导出",
  };
  return labels[status] || status || "-";
}

function reviewStatusLabel(status) {
  const labels = {
    pending: "待确认",
    confirmed: "已确认",
    corrected: "已修正",
    invalid: "判定无效",
  };
  return labels[status] || status || "-";
}

function efficiencyLabel(value) {
  const labels = {
    efficient: "高效",
    normal: "正常",
    needs_review: "待确认",
    review_needed: "待确认",
    blocked: "受阻",
    retrospective: "需复盘",
  };
  return labels[value] || value || "-";
}

function riskLevelLabel(value) {
  const labels = {
    low: "低",
    medium: "中",
    high: "高",
  };
  return labels[value] || value || "-";
}

function yesNoLabel(value) {
  return value ? "是" : "否";
}

function renderSummaryTable(rows, headers) {
  if (!rows?.length) return '<p class="empty-hint">暂无数据。</p>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "-")}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ALLE_RECORD_TEMPLATES = {
  rpa_project: {
    quickLabel: "记录项目进度",
    fields: `
      <div class="grid two-col">
        <label><span>项目名称</span><input name="project_name" required></label>
        <label><span>所属部门</span><input name="department" required></label>
      </div>
      <div class="grid three-col">
        <label>
          <span>项目级别</span>
          <select name="project_level">
            <option value="核心项目">核心项目</option>
            <option value="优化项目">优化项目</option>
            <option value="临时支持">临时支持</option>
          </select>
        </label>
        <label>
          <span>当前阶段</span>
          <select name="current_stage">
            <option value="requirements_collecting">需求收集中</option>
            <option value="requirements_confirmed">需求已确认</option>
            <option value="solution_design">方案设计中</option>
            <option value="developing">开发中</option>
            <option value="testing">测试中</option>
            <option value="trial">业务试用中</option>
            <option value="launched">已正式上线</option>
            <option value="stable">稳定运行</option>
            <option value="optimizing">优化中</option>
            <option value="paused">暂停</option>
            <option value="terminated">已终止</option>
            <option value="completed">已完成</option>
          </select>
        </label>
        <label><span>进度（%）</span><input type="number" min="0" max="100" name="progress_percent" value="0"></label>
      </div>
      <label><span>真实业务问题</span><textarea name="business_problem" rows="2"></textarea></label>
      <label><span>原业务流程</span><textarea name="original_process" rows="2"></textarea></label>
      <label><span>影刀解决方案</span><textarea name="rpa_solution" rows="2"></textarea></label>
      <label><span>今天完成内容</span><textarea name="work_completed_today" rows="2"></textarea></label>
      <label><span>当前结果</span><textarea name="current_result" rows="2"></textarea></label>
      <label><span>问题或风险</span><textarea name="problem_or_risk" rows="2"></textarea></label>
      <div class="grid two-col">
        <label><span>下一步动作</span><textarea name="next_action" rows="2"></textarea></label>
        <label><span>预计完成日期</span><input type="date" name="expected_completion_date"></label>
      </div>
    `,
  },
  efficiency_result: {
    quickLabel: "记录效率数据",
    fields: `
      <div class="grid two-col">
        <label><span>关联项目名称（可选）</span><select name="project_name" data-project-select></select></label>
        <label><span>使用部门</span><input name="department"></label>
      </div>
      <div class="grid three-col">
        <label>
          <span>使用状态</span>
          <select name="usage_status">
            <option value="未使用">未使用</option>
            <option value="试用中">试用中</option>
            <option value="部分使用">部分使用</option>
            <option value="稳定使用">稳定使用</option>
          </select>
        </label>
        <label><span>使用人数</span><input type="number" min="0" name="users_count" value="0"></label>
        <label><span>使用频率描述</span><input name="usage_frequency"></label>
      </div>
      <div class="grid three-col">
        <label><span>自动化前单次耗时（分钟）</span><input type="number" min="0" step="0.1" name="time_before_minutes" value="0"></label>
        <label><span>自动化后单次耗时（分钟）</span><input type="number" min="0" step="0.1" name="time_after_minutes" value="0"></label>
        <label><span>每月执行次数</span><input type="number" min="0" step="1" name="monthly_frequency" value="0"></label>
      </div>
      <div class="grid two-col">
        <label><span>原人工步骤数</span><input type="number" min="0" name="manual_steps_before" value="0"></label>
        <label><span>现人工步骤数</span><input type="number" min="0" name="manual_steps_after" value="0"></label>
      </div>
      <label><span>自动化前错误/异常</span><textarea name="error_before" rows="2"></textarea></label>
      <label><span>自动化后错误/异常</span><textarea name="error_after" rows="2"></textarea></label>
      <label><span>业务价值</span><select name="business_value" data-business-value-select></select></label>
      <label><span>使用反馈</span><textarea name="user_feedback" rows="2"></textarea></label>
      <label><span>剩余问题</span><textarea name="remaining_problem" rows="2"></textarea></label>
    `,
  },
  rpa_capability: {
    quickLabel: "记录影刀学习",
    fields: `
      <div class="grid two-col">
        <label><span>能力名称</span><input name="capability_name" required></label>
        <label><span>关联项目</span><select name="related_project" data-project-select></select></label>
      </div>
      <label><span>学习原因</span><textarea name="learning_reason" rows="2"></textarea></label>
      <label><span>学到了什么</span><textarea name="what_was_learned" rows="2"></textarea></label>
      <label><span>测试结果</span><textarea name="test_result" rows="2"></textarea></label>
      <label><span>业务应用</span><textarea name="business_application" rows="2"></textarea></label>
      <div class="grid three-col">
        <label><span>形成可复用模块</span><select name="reusable_module_created"><option value="false">否</option><option value="true">是</option></select></label>
        <label><span>可复用模块名称</span><input name="reusable_module_name"></label>
        <label><span>文档链接</span><input name="document_link"></label>
      </div>
      <label><span>下一步</span><textarea name="next_step" rows="2"></textarea></label>
    `,
  },
  asset_creation: {
    quickLabel: "记录流程资产",
    fields: `
      <div class="grid two-col">
        <label><span>资产名称</span><input name="asset_name" required></label>
        <label>
          <span>资产类型</span>
          <select name="asset_type">
            <option value="流程模板">流程模板</option>
            <option value="通用模块">通用模块</option>
            <option value="SOP">SOP</option>
            <option value="操作录屏">操作录屏</option>
            <option value="异常处理文档">异常处理文档</option>
            <option value="案例复盘">案例复盘</option>
          </select>
        </label>
      </div>
      <div class="grid two-col">
        <label><span>关联项目</span><select name="related_project" data-project-select></select></label>
        <label><span>适用范围</span><input name="usage_scope"></label>
      </div>
      <label><span>资产说明</span><textarea name="asset_description" rows="2"></textarea></label>
      <div class="grid three-col">
        <label><span>可复用</span><select name="reusable"><option value="true">是</option><option value="false">否</option></select></label>
        <label><span>存放位置</span><input name="storage_location"></label>
        <label><span>适用部门/人员</span><input name="users_or_departments"></label>
        <label><span>版本</span><input name="version"></label>
      </div>
      <label><span>维护说明</span><textarea name="maintenance_note" rows="2"></textarea></label>
    `,
  },
  ai_research: {
    quickLabel: "记录工具测试",
    fields: `
      <div class="grid three-col">
        <label>
          <span>研究类型</span>
          <select name="research_type">
            <option value="提示词">提示词</option>
            <option value="使用方法">使用方法</option>
            <option value="专业工具">专业工具</option>
            <option value="工具对比">工具对比</option>
            <option value="案例研究">案例研究</option>
          </select>
        </label>
        <label><span>研究场景</span><input name="scenario"></label>
        <label><span>所属部门</span><input name="department"></label>
      </div>
      <div class="grid two-col">
        <label><span>工具名称</span><input name="tool_name" required></label>
        <label><span>要解决的问题</span><input name="problem_to_solve"></label>
      </div>
      <label><span>输入要求</span><textarea name="input_requirement" rows="2"></textarea></label>
      <label><span>提示词或方法</span><textarea name="prompt_or_method" rows="2"></textarea></label>
      <label><span>输出结果</span><textarea name="output_result" rows="2"></textarea></label>
      <div class="grid two-col">
        <label><span>人工校核点</span><textarea name="manual_check_points" rows="2"></textarea></label>
        <label><span>适用范围</span><textarea name="applicable_scope" rows="2"></textarea></label>
      </div>
      <div class="grid two-col">
        <label><span>不适用范围</span><textarea name="not_applicable_scope" rows="2"></textarea></label>
        <label><span>成本</span><input name="cost"></label>
      </div>
      <label><span>研究结论</span><textarea name="research_conclusion" rows="2"></textarea></label>
      <div class="grid two-col">
        <label>
          <span>建议动作</span>
          <select name="recommended_action">
            <option value="继续研究">继续研究</option>
            <option value="建议试用">建议试用</option>
            <option value="建议采购">建议采购</option>
            <option value="暂不使用">暂不使用</option>
            <option value="停止使用">停止使用</option>
          </select>
        </label>
        <label><span>文档链接</span><input name="document_link"></label>
      </div>
    `,
  },
  requirement_management: {
    quickLabel: "记录业务需求",
    fields: `
      <div class="grid two-col">
        <label><span>提出部门</span><input name="request_department" required></label>
        <label><span>预估价值</span><input name="estimated_value"></label>
      </div>
      <label><span>需求描述</span><textarea name="request_description" rows="2" required></textarea></label>
      <label><span>真实业务问题</span><textarea name="real_business_problem" rows="2"></textarea></label>
      <div class="grid three-col">
        <label>
          <span>预估难度</span>
          <select name="estimated_difficulty">
            <option value="低">低</option>
            <option value="中">中</option>
            <option value="高">高</option>
          </select>
        </label>
        <label><span>预估工作量</span><input name="estimated_workload"></label>
        <label>
          <span>优先级</span>
          <select name="priority">
            <option value="高">高</option>
            <option value="中">中</option>
            <option value="低">低</option>
          </select>
        </label>
      </div>
      <div class="grid two-col">
        <label><span>适合 AI</span><select name="is_suitable_for_ai"><option value="true">是</option><option value="false">否</option></select></label>
        <label><span>适合影刀</span><select name="is_suitable_for_rpa"><option value="true">是</option><option value="false">否</option></select></label>
      </div>
      <label><span>判断理由</span><textarea name="reason" rows="2"></textarea></label>
      <label><span>建议方案</span><textarea name="recommended_solution" rows="2"></textarea></label>
      <label>
        <span>处理决定</span>
        <select name="decision">
          <option value="进入项目池">进入项目池</option>
          <option value="继续调研">继续调研</option>
          <option value="暂缓">暂缓</option>
          <option value="拒绝">拒绝</option>
          <option value="合并其他需求">合并其他需求</option>
        </select>
      </label>
      <label><span>沟通结果</span><textarea name="communication_result" rows="2"></textarea></label>
      <label><span>风险</span><textarea name="risk" rows="2"></textarea></label>
      <label><span>下一步动作</span><textarea name="next_action" rows="2"></textarea></label>
    `,
  },
  other: {
    quickLabel: "记录其他事项",
    fields: `
      <div class="grid two-col">
        <label><span>标题</span><input name="title" required></label>
        <label><span>所属部门</span><input name="department"></label>
      </div>
      <div class="grid two-col">
        <label><span>关联项目</span><select name="related_project" data-project-select></select></label>
        <label><span>业务价值</span><select name="business_value" data-business-value-select></select></label>
      </div>
      <label><span>摘要</span><textarea name="summary" rows="3" required></textarea></label>
      <label><span>补充说明</span><textarea name="detail" rows="3"></textarea></label>
      <label><span>下一步动作</span><textarea name="next_action" rows="2"></textarea></label>
    `,
  },
};

function getViewer() {
  return state.data?.viewer || null;
}

function syncViewerUrl(viewerId) {
  const nextUrl = new URL(window.location.href);
  if (viewerId) {
    nextUrl.searchParams.set("viewer", viewerId);
  } else {
    nextUrl.searchParams.delete("viewer");
  }
  window.history.replaceState({}, "", nextUrl);
}

function setupRequired() {
  return Boolean(state.data?.setupRequired);
}

function viewerHasRole(role) {
  return Boolean(getViewer()?.roles?.includes(role));
}

function userIsManagerLike(user) {
  return Boolean(user?.roles?.includes("admin") || user?.roles?.includes("supervisor"));
}

function isManagerLike() {
  return userIsManagerLike(getViewer());
}

function isEmployeeLike() {
  return viewerHasRole("employee") || viewerHasRole("admin") || viewerHasRole("supervisor");
}

function isAlleUser(user) {
  if (!user) return false;
  return user.name === "阿勒" || String(user.position || "").includes("AI应用研究员") || String(user.position || "").includes("流程应用");
}

function getAlleUser() {
  return (state.data?.users || []).find((item) => isAlleUser(item)) || null;
}

function isAlleViewer() {
  return isAlleUser(getViewer());
}

function requiresAuthCode(user) {
  return Boolean(user?.requiresAuthCode);
}

function managerAccessRule() {
  return state.data?.auth?.managerSwitchRule || "主管或管理身份切换需要验证码。";
}

function canAccessTab(button) {
  const roles = (button.dataset.roles || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!roles.length) return true;
  const viewer = getViewer();
  return Boolean(viewer && roles.some((role) => viewer.roles.includes(role)));
}

function userById(id) {
  return state.data?.users.find((item) => item.id === id);
}

function objectiveById(id) {
  return state.data?.objectives.find((item) => item.id === id);
}

function resultById(id) {
  return state.data?.results.find((item) => item.id === id);
}

function taskById(id) {
  return state.data?.tasks.find((item) => item.id === id);
}

function assignableUsersForViewer() {
  const users = state.data?.users.filter((item) => item.roles.includes("employee") || item.roles.includes("supervisor") || item.roles.includes("admin")) || [];
  if (isManagerLike()) return users;
  const viewer = getViewer();
  return viewer ? users.filter((item) => item.id === viewer.id) : [];
}

function roleRecordOwnersForViewer() {
  const users = state.data?.users.filter((item) => item.roles.includes("employee")) || [];
  if (isManagerLike()) return users;
  const viewer = getViewer();
  return viewer?.roles?.includes("employee") ? users.filter((item) => item.id === viewer.id) : [];
}

function visibleTasks() {
  const tasks = state.data?.tasks || [];
  if (isManagerLike()) return tasks;
  const viewer = getViewer();
  return viewer ? tasks.filter((item) => item.ownerId === viewer.id) : [];
}

function visibleResults() {
  const results = state.data?.results || [];
  if (isManagerLike()) return results;
  const viewer = getViewer();
  if (!viewer) return [];
  const taskResultIds = new Set(visibleTasks().map((item) => item.resultId));
  return results.filter((item) => item.ownerId === viewer.id || taskResultIds.has(item.id));
}

function visibleObjectives() {
  const objectives = state.data?.objectives || [];
  if (isManagerLike()) return objectives;
  const viewer = getViewer();
  if (!viewer) return [];
  const resultObjectiveIds = new Set(visibleResults().map((item) => item.objectiveId));
  const taskObjectiveIds = new Set(visibleTasks().map((item) => item.objectiveId));
  return objectives.filter((item) => item.ownerId === viewer.id || resultObjectiveIds.has(item.id) || taskObjectiveIds.has(item.id));
}

function visibleReports() {
  const reports = (state.data?.monthlyReports || [])
    .filter((item) => item.reportMonth === state.month)
    .sort((left, right) => {
      const leftPending = left.reportStatus === "supervisor_review" ? 1 : 0;
      const rightPending = right.reportStatus === "supervisor_review" ? 1 : 0;
      if (leftPending !== rightPending) return rightPending - leftPending;
      return (right.generatedAt || "").localeCompare(left.generatedAt || "");
    });
  if (isManagerLike()) return reports;
  const viewer = getViewer();
  return viewer ? reports.filter((item) => item.userId === viewer.id) : [];
}

function latestReviewByAnalysis(analysisId) {
  return state.data?.managerReviews.find((item) => item.aiAnalysisId === analysisId) || null;
}

function showFeedback(node, type, message) {
  if (!node) return;
  node.hidden = false;
  node.className = `feedback ${type}`;
  node.textContent = message;
}

function hideFeedback(node) {
  if (!node) return;
  node.hidden = true;
  node.className = "feedback";
  node.textContent = "";
}

function ensureFeedbackNode(form, id) {
  let node = form.querySelector(`#${id}`);
  if (node) return node;
  node = document.createElement("div");
  node.id = id;
  node.hidden = true;
  node.className = "feedback";
  const actions = form.querySelector(".toolbar-actions");
  const submitButton = form.querySelector('button[type="submit"]');
  if (actions) {
    form.insertBefore(node, actions);
  } else if (submitButton) {
    form.insertBefore(node, submitButton);
  } else {
    form.appendChild(node);
  }
  return node;
}

const objectiveFeedback = ensureFeedbackNode(objectiveForm, "objectiveFeedback");
const resultFeedback = ensureFeedbackNode(resultForm, "resultFeedback");
const roleRecordFeedback = roleRecordForm ? ensureFeedbackNode(roleRecordForm, "roleRecordFeedback") : null;
const taskFeedback = ensureFeedbackNode(taskForm, "taskFeedback");
const progressFeedback = ensureFeedbackNode(progressForm, "progressFeedback");
const reviewFeedback = ensureFeedbackNode(reviewForm, "reviewFeedback");
const setupFeedback = ensureFeedbackNode(setupForm, "setupFeedback");

function setButtonBusy(button, busy, busyText = "处理中...") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.textContent = busyText;
    return;
  }
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
  button.disabled = false;
}

function showToast(type, message) {
  let stack = document.getElementById("toastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toastStack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  stack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 2600);
}

async function readResponseData(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function selectHasRealOptions(select) {
  return Boolean(select && Array.from(select.options).some((option) => option.value));
}

function setLoadingState(loading) {
  state.loading = loading;
  refreshButton.disabled = loading;
  viewerSelect.disabled = loading || setupRequired();
  monthInput.disabled = loading || setupRequired();
}

function rememberActiveTab(tabName) {
  if (!tabName) return;
  localStorage.setItem(TAB_KEY, tabName);
}

function setPendingFocus(type, id) {
  state.pendingFocus = type && id ? { type, id } : null;
}

function applyPendingFocus() {
  if (!state.pendingFocus) return;
  const selectorMap = {
    user: `[data-user-id="${state.pendingFocus.id}"]`,
    objective: `[data-objective-id="${state.pendingFocus.id}"]`,
    result: `[data-result-id="${state.pendingFocus.id}"]`,
    task: `[data-task-id="${state.pendingFocus.id}"]`,
    review: `[data-review-id="${state.pendingFocus.id}"]`,
    report: `[data-report-id="${state.pendingFocus.id}"]`,
    role_record: `[data-role-record-id="${state.pendingFocus.id}"]`,
  };
  const selector = selectorMap[state.pendingFocus.type];
  if (!selector) return;
  const target = document.querySelector(selector);
  if (!target) return;
  target.classList.add("just-created");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("just-created"), 2200);
  state.pendingFocus = null;
}

function findReportForUser(userId, preferredStatuses = []) {
  const reports = visibleReports().filter((item) => item.userId === userId);
  if (!reports.length) return null;
  for (const status of preferredStatuses) {
    const matched = reports.find((item) => item.reportStatus === status);
    if (matched) return matched;
  }
  return reports[0];
}

function findReportByStatus(status) {
  return visibleReports().find((item) => item.reportStatus === status) || null;
}

function navigateToTab(tabName, { focusType = null, focusId = null, reportId = null } = {}) {
  if (focusType && focusId) setPendingFocus(focusType, focusId);
  if (reportId) state.selectedReportId = reportId;
  state.activeTab = tabName;
  render();
}

function openUserReportOrProfile(userId, preferredStatuses = []) {
  const report = findReportForUser(userId, preferredStatuses);
  if (report) {
    navigateToTab("reports", { focusType: "report", focusId: report.id, reportId: report.id });
    return;
  }
  navigateToTab("users", { focusType: "user", focusId: userId });
}

function bindDashboardNavigation() {
  document.querySelectorAll("[data-nav-tab]").forEach((node) => {
    node.addEventListener("click", () => {
      const tabName = node.dataset.navTab;
      const focusType = node.dataset.focusType || null;
      const focusId = node.dataset.focusId || null;
      const reportId = node.dataset.reportId || null;
      if (!tabName) return;
      navigateToTab(tabName, { focusType, focusId, reportId });
    });
  });

  document.querySelectorAll("[data-report-user-id]").forEach((node) => {
    node.addEventListener("click", () => {
      openUserReportOrProfile(node.dataset.reportUserId, ["supervisor_review", "confirmed", "employee_review", "draft"]);
    });
  });

  document.querySelectorAll("[data-report-status]").forEach((node) => {
    node.addEventListener("click", () => {
      const report = findReportByStatus(node.dataset.reportStatus);
      if (report) {
        navigateToTab("reports", { focusType: "report", focusId: report.id, reportId: report.id });
        return;
      }
      navigateToTab("reports");
    });
  });
}

async function loadBootstrap() {
  heroStatus.textContent = "加载中...";
  const response = await apiFetch(`/bootstrap?month=${encodeURIComponent(state.month)}&viewer_id=${encodeURIComponent(state.viewerId)}`, {
    method: "GET",
    headers: {},
  });
  if (!response.ok) {
    throw new Error("加载失败，请稍后重试。");
  }
  state.data = await response.json();
  if (!setupRequired() && state.data.viewer?.id) {
    state.viewerId = state.data.viewer.id;
    if (userIsManagerLike(state.data.viewer)) {
      localStorage.removeItem(VIEWER_KEY);
      syncViewerUrl("");
    } else {
      localStorage.setItem(VIEWER_KEY, state.viewerId);
      syncViewerUrl(state.viewerId);
    }
  }
  heroStatus.textContent = "已同步";
  render();
}

function renderViewerOptions() {
  const current = state.viewerId;
  viewerSelect.innerHTML = "";
  if (setupRequired()) {
    return;
  }
  for (const user of state.data.users) {
    const option = document.createElement("option");
    option.value = user.id;
    const authSuffix = requiresAuthCode(user) ? " / 需验证" : "";
    option.textContent = `${user.name} / ${user.position || "未设置岗位"} / ${roleLabel(user)}${authSuffix}`;
    viewerSelect.appendChild(option);
  }
  viewerSelect.value = current;
}

function visibleRoleRecords() {
  const records = state.data?.roleRecords || [];
  if (isManagerLike()) return records;
  const viewer = getViewer();
  return viewer ? records.filter((item) => item.userId === viewer.id) : [];
}

function renderHeader() {
  const viewer = getViewer();
  const pendingAuthViewer = state.data?.authRequestedViewer || null;
  heroMonth.textContent = state.month;
  heroViewer.textContent = pendingAuthViewer
    ? `${pendingAuthViewer.name} / ${pendingAuthViewer.position || "-"}`
    : viewer ? `${viewer.name} / ${viewer.position || "-"}` : "尚未初始化";
  if (pendingAuthViewer) {
    viewerCard.innerHTML = `正在进入 <strong>${escapeHtml(pendingAuthViewer.name)}</strong> 的主管/管理身份，请先完成验证码验证。`;
    return;
  }
  viewerCard.innerHTML = viewer
    ? `当前身份：<strong>${escapeHtml(viewer.name)}</strong>，角色为 <strong>${escapeHtml(roleLabel(viewer))}</strong>。${isManagerLike() ? `当前主管/管理身份已通过验证。` : `如需进入主管或管理身份，请在切换时输入验证码。`}`
    : "当前还没有激活身份，系统正在等待初始化。";
}

function openAuthModal(targetUser) {
  if (!targetUser) return;
  state.pendingAuthUserId = targetUser.id;
  authTitle.textContent = `进入 ${targetUser.name} 的主管/管理身份`;
  authHint.innerHTML = `请输入主管或管理身份验证码：<strong>8888</strong>。<br>目标身份：${escapeHtml(targetUser.name)}`;
  authCodeInput.value = "";
  if (authConfirmButton) {
    setButtonBusy(authConfirmButton, false);
    authConfirmButton.disabled = false;
  }
  authModal.hidden = false;
  window.setTimeout(() => authCodeInput.focus(), 20);
}

function closeAuthModal() {
  authModal.hidden = true;
  authCodeInput.value = "";
  state.pendingAuthUserId = null;
}

function renderSelects() {
  if (setupRequired()) {
    objectiveOwner.innerHTML = "";
    resultOwner.innerHTML = "";
    taskOwner.innerHTML = "";
    resultObjective.innerHTML = "";
    taskResult.innerHTML = "";
    progressTask.innerHTML = "";
    reviewAnalysis.innerHTML = '<option value="">请先初始化系统</option>';
    return;
  }
  const users = state.data.users.filter((item) => item.roles.includes("employee") || item.roles.includes("supervisor") || item.roles.includes("admin"));
  objectiveOwner.innerHTML = users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("");
  resultOwner.innerHTML = users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("");
  taskOwner.innerHTML = users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("");

  resultObjective.innerHTML = state.data.objectives.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  taskResult.innerHTML = state.data.results.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  progressTask.innerHTML = state.data.tasks.map((item) => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join("");
  reviewAnalysis.innerHTML = state.data.pendingReviews.length
    ? state.data.pendingReviews.map((item) => `<option value="${item.id}">${escapeHtml(item.generatedText || `${item.targetType} ${item.targetId}`)}</option>`).join("")
    : '<option value="">当前没有待确认项</option>';
}
function renderDashboard() {
  // Replaced by later overrides. Keep a minimal valid baseline for parsing.
  const metrics = state.data?.dashboard?.metrics;
  if (!metrics) {
    const statsNode = document.getElementById("dashboardStats");
    const badgeNode = document.getElementById("dashboardBadges");
    const focusNode = document.getElementById("dashboardFocusStory");
    const statusChartNode = document.getElementById("dashboardStatusChart");
    const objectiveNode = document.getElementById("objectiveBoardBody");
    const resultNode = document.getElementById("resultBoardBody");
    const peopleNode = document.getElementById("peopleBoardBody");
    const riskNode = document.getElementById("riskBoardList");
    const valueNode = document.getElementById("valueBoardList");
    if (statsNode) statsNode.innerHTML = "";
    if (badgeNode) badgeNode.innerHTML = "";
    if (focusNode) focusNode.innerHTML = "";
    if (statusChartNode) statusChartNode.innerHTML = "";
    if (objectiveNode) objectiveNode.innerHTML = "";
    if (resultNode) resultNode.innerHTML = "";
    if (peopleNode) peopleNode.innerHTML = "";
    if (riskNode) riskNode.innerHTML = "";
    if (valueNode) valueNode.innerHTML = "";
    return;
  }

  document.getElementById("dashboardStats").innerHTML = "";
  document.getElementById("dashboardBadges").innerHTML = "";
  document.getElementById("dashboardFocusStory").innerHTML = "";
  document.getElementById("dashboardStatusChart").innerHTML = "";
  document.getElementById("objectiveBoardBody").innerHTML = "";
  document.getElementById("resultBoardBody").innerHTML = "";
  document.getElementById("peopleBoardBody").innerHTML = "";
  document.getElementById("riskBoardList").innerHTML = "";
  document.getElementById("valueBoardList").innerHTML = "";
}
renderDashboard = function renderDashboardOverride() {
  // Transitional override kept minimal. The interactive override below is the active implementation.
  return renderDashboard();
};
renderDashboard = function renderDashboardInteractiveOverride() {
  if (!state.data.dashboard || !state.data.dashboard.metrics) {
    const statsNode = document.getElementById("dashboardStats");
    const badgeNode = document.getElementById("dashboardBadges");
    const focusNode = document.getElementById("dashboardFocusStory");
    const statusChartNode = document.getElementById("dashboardStatusChart");
    const objectiveNode = document.getElementById("objectiveBoardBody");
    const resultNode = document.getElementById("resultBoardBody");
    const peopleNode = document.getElementById("peopleBoardBody");
    const riskNode = document.getElementById("riskBoardList");
    const valueNode = document.getElementById("valueBoardList");
    if (statsNode) statsNode.innerHTML = "";
    if (badgeNode) badgeNode.innerHTML = "";
    if (focusNode) focusNode.innerHTML = '<p class="empty-hint">管理看板仅对管理角色开放。</p>';
    if (statusChartNode) statusChartNode.innerHTML = "";
    if (objectiveNode) objectiveNode.innerHTML = "";
    if (resultNode) resultNode.innerHTML = "";
    if (peopleNode) peopleNode.innerHTML = "";
    if (riskNode) riskNode.innerHTML = "";
    if (valueNode) valueNode.innerHTML = "";
    return;
  }

  const stats = state.data.dashboard.metrics;
  const reportBoard = state.data.dashboard.reportBoard || { statusCounts: [], pendingUsers: [], confirmedUsers: [] };
  const dashboardGrid = document.querySelector(".dashboard-grid");
  if (dashboardGrid) dashboardGrid.classList.add("editorial-dashboard-grid");

  const summaryCards = [
    { label: "事项完成率", value: formatPercent(stats.completionRate), tone: "blue", tab: "tasks" },
    { label: "上线/交付率", value: formatPercent(stats.launchRate), tone: "orange", tab: "tasks" },
    { label: "待确认月报", value: stats.pendingReportCount || 0, tone: "yellow", status: "supervisor_review" },
  ];

  document.getElementById("dashboardStats").innerHTML = summaryCards.map((item) => `
    <article
      class="summary-stat tone-${item.tone} is-actionable"
      ${item.tab ? `data-nav-tab="${item.tab}"` : ""}
      ${item.status ? `data-report-status="${item.status}"` : ""}
    >
      <span>${item.label}</span>
      <strong>${item.value}</strong>
    </article>
  `).join("");

  const badgeNode = document.getElementById("dashboardBadges");
  if (badgeNode) {
    badgeNode.innerHTML = `
      <span class="focus-badge tone-blue is-actionable" data-nav-tab="objectives">目标 ${stats.objectiveCount}</span>
      <span class="focus-badge tone-orange is-actionable" data-nav-tab="results">成果 ${stats.resultCount}</span>
      <span class="focus-badge tone-yellow is-actionable" data-nav-tab="tasks">事项 ${stats.taskCount}</span>
      <span class="focus-badge tone-blue is-actionable" data-nav-tab="reports">月报 ${stats.reportCount || 0}</span>
      <span class="focus-badge tone-orange is-actionable" data-report-status="confirmed">已确认 ${stats.confirmedReportCount || 0}</span>
    `;
  }

  const focusNode = document.getElementById("dashboardFocusStory");
  if (focusNode) {
    focusNode.innerHTML = `
      <div class="summary-hero">
        <div class="summary-ring">
          <div class="summary-ring-core">
            <span>月度概览</span>
            <strong>${formatPercent((Number(stats.completionRate || 0) + Number(stats.launchRate || 0)) / 2)}</strong>
          </div>
        </div>
        <div class="summary-bars">
          <div class="summary-bar-row is-actionable" data-nav-tab="objectives">
            <label>目标</label>
            <div class="summary-bar"><i style="width:${Math.max(12, clampPercent(stats.objectiveCount * 18))}%"></i></div>
            <strong>${stats.objectiveCount}</strong>
          </div>
          <div class="summary-bar-row is-actionable" data-nav-tab="results">
            <label>成果</label>
            <div class="summary-bar"><i style="width:${Math.max(12, clampPercent(stats.resultCount * 20))}%"></i></div>
            <strong>${stats.resultCount}</strong>
          </div>
          <div class="summary-bar-row is-actionable" data-nav-tab="tasks">
            <label>事项</label>
            <div class="summary-bar"><i style="width:${Math.max(12, clampPercent(stats.taskCount * 12))}%"></i></div>
            <strong>${stats.taskCount}</strong>
          </div>
          <div class="summary-bar-row is-actionable" data-nav-tab="tasks">
            <label>跨月事项</label>
            <div class="summary-bar"><i style="width:${Math.max(10, clampPercent(stats.crossMonthCount * 28))}%"></i></div>
            <strong>${stats.crossMonthCount}</strong>
          </div>
          <div class="summary-bar-row is-actionable" data-nav-tab="reports">
            <label>月报覆盖率</label>
            <div class="summary-bar"><i style="width:${Math.max(10, clampPercent(stats.reportCoverage || 0))}%"></i></div>
            <strong>${formatPercent(stats.reportCoverage || 0)}</strong>
          </div>
        </div>
      </div>
      <div class="summary-brief">
        <p>
          <strong>待确认：</strong>
          ${reportBoard.pendingUsers.length ? reportBoard.pendingUsers.map((name) => {
            const user = (state.data.users || []).find((item) => item.name === name);
            return user
              ? `<button class="summary-brief-link" type="button" data-report-user-id="${user.id}">${escapeHtml(name)}</button>`
              : escapeHtml(name);
          }).join(" / ") : "暂无"}
        </p>
        <p>
          <strong>已确认：</strong>
          ${reportBoard.confirmedUsers.length ? reportBoard.confirmedUsers.map((name) => {
            const user = (state.data.users || []).find((item) => item.name === name);
            return user
              ? `<button class="summary-brief-link" type="button" data-report-user-id="${user.id}">${escapeHtml(name)}</button>`
              : escapeHtml(name);
          }).join(" / ") : "暂无"}
        </p>
      </div>
    `;
  }

  const legacyVisual = document.querySelector(".dashboard-visual-grid");
  if (legacyVisual) {
    const legacyPulse = legacyVisual.querySelector(".contrast-panel");
    if (legacyPulse) {
      legacyPulse.hidden = false;
      const pulseNode = document.getElementById("dashboardPulse");
      if (pulseNode) {
        pulseNode.innerHTML = `
          <div class="editorial-pulse">
            <div class="editorial-pulse-art">
              <div class="editorial-pulse-orb orb-warm"></div>
              <div class="editorial-pulse-orb orb-soft"></div>
              <div class="editorial-pulse-figure"></div>
            </div>
            <div class="editorial-pulse-copy">
              <p class="editorial-kicker">月度节奏</p>
              <h4>从管理看板直接进入处理动作</h4>
              <p>点击目标进入推进检查，点击成果进入交付查看，点击待确认月报可直接跳入主管确认。</p>
              <div class="editorial-pulse-metrics">
                <div><span>完成率</span><strong>${formatPercent(stats.completionRate)}</strong></div>
                <div><span>上线率</span><strong>${formatPercent(stats.launchRate)}</strong></div>
                <div><span>待确认</span><strong>${stats.pendingReportCount || 0}</strong></div>
              </div>
            </div>
          </div>
        `;
      }
    }
    legacyVisual.classList.remove("dashboard-visual-grid-compact");
  }

  const statusChartNode = document.getElementById("dashboardStatusChart");
  if (statusChartNode) {
    const items = (reportBoard.statusCounts || []).map((item) => [item.status, item.count]);
    const maxCount = Math.max(...items.map(([, count]) => count), 1);
    const palette = ["blue", "orange", "yellow", "ink", "blue"];
    statusChartNode.innerHTML = items.length
      ? items.map(([status, count], index) => `
        <div class="status-row tone-${palette[index % palette.length]} is-actionable" data-report-status="${escapeHtml(status)}">
          <div class="status-meta">
            <span>${escapeHtml(reportStatusLabel(status))}</span>
            <strong>${count}</strong>
          </div>
          <div class="status-bar"><i style="width:${(count / maxCount) * 100}%"></i></div>
        </div>
      `).join("")
      : '<p class="empty-hint">当前还没有月报状态数据。</p>';
  }

  const objectiveMount = document.getElementById("objectiveBoardBody");
  if (objectiveMount) {
    const objectiveWrap = objectiveMount.closest(".table-wrap");
    if (objectiveWrap) {
      objectiveWrap.outerHTML = '<div id="objectiveBoardBody" class="editorial-stream"></div>';
    }
  }
  document.getElementById("objectiveBoardBody").innerHTML = state.data.dashboard.objectiveBoard.map((item, index) => `
    <article class="editorial-note is-actionable" data-nav-tab="objectives" data-focus-type="objective" data-focus-id="${item.objectiveId}">
      <span class="editorial-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="editorial-note-body">
        <h4>${escapeHtml(item.name)}</h4>
        <p>${escapeHtml(objectiveStatusLabel(item.status))} / 推进率 ${formatPercent(item.progressRatio * 100)}</p>
        <div class="editorial-line"><i style="width:${clampPercent(item.progressRatio * 100)}%"></i></div>
      </div>
    </article>
  `).join("") || '<p class="empty-hint">当前还没有目标数据。</p>';

  const resultMount = document.getElementById("resultBoardBody");
  if (resultMount) {
    const resultWrap = resultMount.closest(".table-wrap");
    if (resultWrap) {
      resultWrap.outerHTML = '<div id="resultBoardBody" class="editorial-ribbons"></div>';
    }
  }
  document.getElementById("resultBoardBody").innerHTML = state.data.dashboard.resultBoard.map((item) => `
    <article class="editorial-ribbon is-actionable" data-nav-tab="results" data-focus-type="result" data-focus-id="${item.resultId}">
      <header>
        <h4>${escapeHtml(item.name)}</h4>
        <span>${escapeHtml(resultStageLabel(item.stage))}</span>
      </header>
      <p>事项 ${item.taskCount} / 风险 ${item.riskCount}</p>
    </article>
  `).join("") || '<p class="empty-hint">当前还没有成果数据。</p>';

  const peopleMount = document.getElementById("peopleBoardBody");
  if (peopleMount) {
    const peopleWrap = peopleMount.closest(".table-wrap");
    if (peopleWrap) {
      peopleWrap.outerHTML = '<div id="peopleBoardBody" class="editorial-portraits"></div>';
    }
  }
  document.getElementById("peopleBoardBody").innerHTML = state.data.dashboard.peopleBoard.map((item) => `
    <article class="editorial-portrait is-actionable" data-report-user-id="${item.userId}">
      <div class="editorial-portrait-head">
        <span class="editorial-avatar">${escapeHtml((item.name || "?").slice(0, 1))}</span>
        <div>
          <h4>${escapeHtml(item.name)}</h4>
          <p>${item.taskCount} 条事项 / 完成率 ${formatPercent(item.completionRate)}</p>
        </div>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(riskLevelLabel(item.riskLevel))}</span>
        <span class="tag">${escapeHtml(item.abilityTags.join(" / ") || "建设中")}</span>
      </div>
    </article>
  `).join("") || '<p class="empty-hint">当前还没有成员数据。</p>';

  document.getElementById("riskBoardList").innerHTML = state.data.dashboard.riskBoard.map((item) => `
    <li class="editorial-signal-item is-actionable" data-nav-tab="reviews"><span>${escapeHtml(item.riskType)}</span><strong>${item.count}</strong></li>
  `).join("") || '<li class="editorial-signal-item"><span>暂无风险</span><strong>0</strong></li>';

  document.getElementById("valueBoardList").innerHTML = state.data.dashboard.valueBoard.map((item) => `
    <li class="editorial-signal-item is-actionable" data-nav-tab="tasks"><span>${escapeHtml(item.valueLevel)}</span><strong>${item.count}</strong></li>
  `).join("") || '<li class="editorial-signal-item"><span>暂无价值数据</span><strong>0</strong></li>';

  bindDashboardNavigation();
};

function renderUsers() {
  userList.innerHTML = state.data.users
    .filter((item) => !item.roles.includes("ai_system"))
    .map((item) => `
      <article class="list-card" data-user-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(roleLabel(item))}</span>
              <span class="tag">${escapeHtml(item.position || "-")}</span>
            </div>
          </div>
        </header>
        <p>${escapeHtml(item.department)}</p>
      </article>
    `)
    .join("") || '<p class="empty-hint">暂无成员身份。</p>';
}

function renderObjectives() {
  document.getElementById("objectiveList").innerHTML = state.data.objectives.map((item) => {
    const owner = userById(item.ownerId);
    return `
      <article class="list-card">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(item.status)}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || item.ownerId)}</span>
              <span class="tag">来源：${escapeHtml(objectiveSourceLabel(item.sourceType))}</span>
              ${item.sourceDepartment ? `<span class="tag">发起部门：${escapeHtml(item.sourceDepartment)}</span>` : ""}
            </div>
          </div>
          <small class="muted">${escapeHtml(item.dueDate)}</small>
        </header>
        <p>${escapeHtml(item.description)}</p>
        ${item.sourceDetail ? `<p class="muted">发起说明：${escapeHtml(item.sourceDetail)}</p>` : ""}
        <div class="tag-row">${item.successCriteria.map((text) => `<span class="tag">${escapeHtml(text)}</span>`).join("")}</div>
      </article>
    `;
  }).join("") || '<p class="empty-hint">暂无目标</p>';
}

function renderResults() {
  document.getElementById("resultList").innerHTML = state.data.results.map((item) => {
    const objective = objectiveById(item.objectiveId);
    const owner = userById(item.ownerId);
    return `
      <article class="list-card">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(resultStageLabel(item.stage))}</span>
              <span class="tag">目标：${escapeHtml(objective?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || item.ownerId)}</span>
            </div>
          </div>
          <small class="muted">${escapeHtml(item.dueDate)}</small>
        </header>
        <p>${escapeHtml(item.description)}</p>
        <div class="tag-row">${item.completionCriteria.map((text) => `<span class="tag">${escapeHtml(text)}</span>`).join("")}</div>
      </article>
    `;
  }).join("") || '<p class="empty-hint">暂无成果</p>';
}

function renderTasks() {
  const progressMap = new Map();
  for (const item of state.data.taskProgress) {
    if (!progressMap.has(item.taskId)) progressMap.set(item.taskId, []);
    progressMap.get(item.taskId).push(item);
  }

  document.getElementById("taskList").innerHTML = state.data.tasks.map((task) => {
    const result = resultById(task.resultId);
    const owner = userById(task.ownerId);
    const analysis = state.data.aiAnalysis.find((item) => item.targetType === "task" && item.targetId === task.id);
    const review = analysis ? latestReviewByAnalysis(analysis.id) : null;
    const progressItems = progressMap.get(task.id) || [];
    return `
      <article class="task-card" data-task-id="${task.id}">
        <header>
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(task.currentStatus)}</span>
              <span class="tag">成果：${escapeHtml(result?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || task.ownerId)}</span>
            </div>
          </div>
          <small class="muted">累计 ${task.totalInputHours} 小时 / ${task.progressCount} 次进展</small>
        </header>
        <p>${escapeHtml(task.content)}</p>
        <div class="tag-row">
          <span class="tag">计划完成：${escapeHtml(task.plannedCompleteDate || "未填写")}</span>
          <span class="tag">跨月：${task.isCrossMonth ? "是" : "否"}</span>
          <span class="tag">延期：${task.isDelayed ? "是" : "否"}</span>
        </div>
        ${analysis ? `
          <div class="report-section">
            <strong>AI判断</strong>
            <p>${escapeHtml(analysis.generatedText || "")}</p>
            <div class="tag-row">
              <span class="tag">价值：${escapeHtml(analysis.valueLevel || "-")}</span>
              <span class="tag">效率：${escapeHtml(analysis.efficiencyJudgement || "-")}</span>
              <span class="tag">成长：${escapeHtml(analysis.growthLevel || "-")}</span>
              <span class="tag">风险：${escapeHtml(analysis.riskLevel || "-")}</span>
            </div>
            <small class="muted">${escapeHtml(analysis.reasoning)}</small>
            ${review ? `<p class="muted">主管状态：${escapeHtml(review.reviewStatus)}${review.comment ? ` / ${escapeHtml(review.comment)}` : ""}</p>` : ""}
          </div>
        ` : ""}
        ${progressItems.length ? `
          <div class="report-section">
            <strong>最新进展</strong>
            <ul>
              ${progressItems.slice(0, 3).map((item) => `<li>${escapeHtml(item.createdAt.slice(0, 10))} / ${escapeHtml(item.progressContent)} / ${item.inputHours}h</li>`).join("")}
            </ul>
          </div>
        ` : ""}
      </article>
    `;
  }).join("") || '<p class="empty-hint">暂无事项</p>';
}

function renderReviews() {
  document.getElementById("pendingReviewList").innerHTML = state.data.pendingReviews.map((item) => {
    const task = taskById(item.targetId);
    return `
      <article class="list-card">
        <header>
          <div>
            <h3>${escapeHtml(task?.title || item.targetId)}</h3>
            <div class="meta-line">
              <span class="status-pill">待确认</span>
              <span class="tag">价值 ${escapeHtml(item.valueLevel || "-")}</span>
              <span class="tag">风险 ${escapeHtml(item.riskLevel || "-")}</span>
            </div>
          </div>
        </header>
        <p>${escapeHtml(item.generatedText || "")}</p>
        <small class="muted">${escapeHtml(item.reasoning)}</small>
      </article>
    `;
  }).join("") || '<p class="empty-hint">当前没有需要主管确认的 AI 判断。</p>';
}

function renderReports() {
  document.getElementById("reportList").innerHTML = state.data.monthlyReports
    .filter((item) => item.reportMonth === state.month)
    .map((item) => {
      const user = userById(item.userId);
      return `
        <article class="list-card report-entry" data-report-id="${item.id}">
          <header>
            <div>
              <h3>${escapeHtml(user?.name || item.userId)}</h3>
              <div class="meta-line">
                <span class="status-pill">${escapeHtml(reportStatusLabel(item.reportStatus))}</span>
                <span class="tag">${escapeHtml(item.reportMonth)}</span>
              </div>
            </div>
          </header>
          <p>${escapeHtml(item.aiGeneratedContent.narrative || "暂无摘要。")}</p>
        </article>
      `;
    }).join("") || '<p class="empty-hint">本月还没有生成月报。</p>';

  document.querySelectorAll(".report-entry").forEach((node) => {
    node.addEventListener("click", () => showReport(node.dataset.reportId));
  });
}

function showReport(reportId) {
  const report = state.data.monthlyReports.find((item) => item.id === reportId);
  if (!report) return;
  const user = userById(report.userId);
  const content = report.aiGeneratedContent || {};
  const finalContent = report.finalContent || {};
  const detail = document.getElementById("reportDetail");
  detail.innerHTML = `
    <h3>${escapeHtml(user?.name || report.userId)} / ${escapeHtml(report.reportMonth)} 月报</h3>
    <p class="muted">${escapeHtml(content.narrative || "")}</p>
    <section class="report-section">
      <strong>本月核心工作</strong>
      <ul>${(content.core_work || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>目标推进情况</strong>
      <ul>${(content.objective_progress || []).map((item) => `<li>${escapeHtml(item.name)} / ${formatPercent((item.progressRatio || 0) * 100)} / ${escapeHtml(item.status)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>成果完成情况</strong>
      <ul>${(content.result_progress || []).map((item) => `<li>${escapeHtml(item.name)} / ${escapeHtml(item.stage)} / 完成 ${item.completedTasks}/${item.taskCount}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>效率情况</strong>
      <ul>
        <li>事项完成率：${formatPercent(content.efficiency_summary?.completionRate)}</li>
        <li>上线/交付率：${formatPercent(content.efficiency_summary?.launchRate)}</li>
        <li>累计投入时长：${content.efficiency_summary?.totalInputHours || 0} 小时</li>
      </ul>
    </section>
    <section class="report-section">
      <strong>价值与成长</strong>
      <ul>
        <li>价值类型：${escapeHtml((content.value_output || []).join("、") || "暂无")}</li>
        <li>能力成长：${escapeHtml((content.ability_growth || []).join("、") || "暂无")}</li>
      </ul>
    </section>
    <section class="report-section">
      <strong>问题与风险</strong>
      <ul>${(content.risks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>下月重点</strong>
      <ul>${(content.next_month_focus || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
  `;
}

function applyPermissions() {
  if (setupRequired()) {
    objectiveForm.querySelector("button").disabled = true;
    userForm.querySelector("button").disabled = true;
    resetSystemButton.disabled = true;
    resultForm.querySelector("button").disabled = true;
    taskForm.querySelector("button").disabled = true;
    progressForm.querySelector("button").disabled = true;
    reviewForm.querySelector("button").disabled = true;
    generateReportsButton.disabled = true;
    return;
  }
  objectiveForm.querySelector("button").disabled = !viewerHasRole("admin");
  userForm.querySelector("button").disabled = !viewerHasRole("admin");
  resetSystemButton.disabled = !viewerHasRole("admin");
  resultForm.querySelector("button").disabled = !isEmployeeLike();
  taskForm.querySelector("button").disabled = !isEmployeeLike();
  progressForm.querySelector("button").disabled = !isEmployeeLike();
  reviewForm.querySelector("button").disabled = !isManagerLike();
  generateReportsButton.disabled = !isManagerLike();
}

function applyTabVisibility() {
  if (setupRequired()) {
    tabButtons.forEach((button) => {
      button.hidden = true;
    });
    tabPanels.forEach((panel) => {
      panel.hidden = true;
      panel.classList.remove("active");
    });
    return;
  }

  const panelMap = new Map(tabPanels.map((panel) => [panel.id.replace("tab-", ""), panel]));

  tabButtons.forEach((button) => {
    const visible = canAccessTab(button);
    button.hidden = !visible;
    const panel = panelMap.get(button.dataset.tab);
    if (panel) {
      panel.hidden = !visible;
      if (!visible) {
        panel.classList.remove("active");
      }
    }
  });

  const currentAllowed = tabButtons.find((button) => button.dataset.tab === state.activeTab && !button.hidden);
  if (!currentAllowed) {
    const fallback = tabButtons.find((button) => !button.hidden);
    state.activeTab = fallback ? fallback.dataset.tab : "";
  }
}

function render() {
  if (state.data) {
    heroStatus.textContent = "已同步";
  }
  setupPanel.hidden = !setupRequired();
  document.querySelector(".hero").hidden = setupRequired();
  document.querySelector(".toolbar").hidden = setupRequired();
  document.querySelector(".tabs").hidden = setupRequired();
  document.querySelector("main").hidden = setupRequired();
  renderViewerOptions();
  renderHeader();
  renderSelects();
  renderDashboard();
  renderUsers();
  renderObjectives();
  renderResults();
  renderTasks();
  renderReviews();
  renderReports();
  applyPermissions();
  applyTabVisibility();
  if (!setupRequired()) {
    const targetTab = tabButtons.find((button) => !button.hidden && button.dataset.tab === state.activeTab)
      ? state.activeTab
      : (tabButtons.find((button) => !button.hidden)?.dataset.tab || "dashboard");
    activateTab(targetTab);
  }
}

function formDataObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderRoleRecordFields() {
  const container = document.getElementById("roleRecordFields");
  if (!container || !roleRecordType) return;
  const template = ALLE_RECORD_TEMPLATES[roleRecordType.value] || ALLE_RECORD_TEMPLATES.rpa_project;
  container.innerHTML = template.fields;
  populateRoleRecordDynamicFields();
}

function buildRoleRecordProjectOptions() {
  const projectMap = new Map();
  visibleResults().forEach((item) => {
    const name = String(item.name || "").trim();
    if (!name) return;
    projectMap.set(name, `${name}（成果）`);
  });
  visibleRoleRecords().forEach((item) => {
    if (item.recordType !== "rpa_project") return;
    const name = String(item.relatedProject || item.payload?.project_name || item.title || "").trim();
    if (!name || projectMap.has(name)) return;
    projectMap.set(name, `${name}（项目）`);
  });
  return [...projectMap.entries()];
}

function populateRoleRecordDynamicFields() {
  if (!roleRecordForm) return;
  const projectOptions = buildRoleRecordProjectOptions();
  roleRecordForm.querySelectorAll("[data-project-select]").forEach((select) => {
    const currentValue = select.value || "";
    select.innerHTML = [
      '<option value="">暂不关联项目</option>',
      ...projectOptions.map(([value, label]) => `<option value="${escapeHtml(value)}"${currentValue === value ? " selected" : ""}>${escapeHtml(label)}</option>`),
    ].join("");
  });
  roleRecordForm.querySelectorAll("[data-business-value-select]").forEach((select) => {
    const currentValue = select.value || "";
    select.innerHTML = [
      '<option value="">请选择业务价值</option>',
      ...BUSINESS_VALUE_OPTIONS.map((item) => `<option value="${escapeHtml(item)}"${currentValue === item ? " selected" : ""}>${escapeHtml(item)}</option>`),
    ].join("");
  });
}

function buildRoleRecordPayload() {
  const formData = new FormData(roleRecordForm);
  const raw = Object.fromEntries(formData.entries());
  const payload = {};
  for (const [key, value] of Object.entries(raw)) {
    if (["userId", "recordType", "recordDate", "workHours", "evidenceText"].includes(key)) continue;
    if (value === "") continue;
    if (["progress_percent", "users_count", "monthly_frequency", "manual_steps_before", "manual_steps_after"].includes(key)) {
      payload[key] = Number(value || 0);
    } else if (["time_before_minutes", "time_after_minutes"].includes(key)) {
      payload[key] = Number(value || 0);
    } else if (["is_suitable_for_ai", "is_suitable_for_rpa", "reusable_module_created", "reusable"].includes(key)) {
      payload[key] = value === "true";
    } else {
      payload[key] = value;
    }
  }

  return {
    userId: raw.userId,
    recordType: raw.recordType,
    recordDate: raw.recordDate,
    workHours: Number(raw.workHours || 0),
    payload,
    evidence: splitLines(raw.evidenceText || ""),
  };
}

function renderRoleRecordList() {
  const quickNode = document.getElementById("roleRecordQuickActions");
  if (quickNode) {
    quickNode.innerHTML = Object.entries(ALLE_RECORD_TEMPLATES).map(([key, config]) => `
      <button class="ghost-button" type="button" data-record-type="${key}">${escapeHtml(config.quickLabel)}</button>
    `).join("");
    quickNode.querySelectorAll("[data-record-type]").forEach((button) => {
      button.addEventListener("click", () => {
        if (roleRecordType) roleRecordType.value = button.dataset.recordType;
        renderRoleRecordFields();
      });
    });
  }
  const listNode = document.getElementById("roleRecordList");
  if (!listNode) return;
  const records = visibleRoleRecords().filter((item) => isAlleUser(userById(item.userId)));
  const projects = new Map();
  for (const item of records) {
    if (item.recordType !== "rpa_project") continue;
    const payload = item.payload || {};
    const projectName = payload.project_name || item.relatedProject || item.title;
    if (!projectName) continue;
    if (!projects.has(projectName)) {
      projects.set(projectName, {
        projectName,
        department: payload.department || item.department || "",
        stage: item.stage || payload.current_stage || "",
        progress: Number(payload.progress_percent || 0),
        updates: [],
      });
    }
    const project = projects.get(projectName);
    project.stage = item.stage || payload.current_stage || project.stage;
    project.progress = Math.max(project.progress, Number(payload.progress_percent || 0));
    project.updates.push({
      id: item.id,
      date: item.recordDate,
      stage: item.stage || payload.current_stage || "",
      progress: Number(payload.progress_percent || 0),
      summary: payload.work_completed_today || payload.current_result || payload.problem_or_risk || "已更新项目进度",
    });
  }
  const projectCards = [...projects.values()]
    .sort((a, b) => b.progress - a.progress || a.projectName.localeCompare(b.projectName, "zh-CN"))
    .map((project) => `
      <article class="list-card">
        <header>
          <div>
            <h3>${escapeHtml(project.projectName)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(alleStageLabel(project.stage))}</span>
              <span class="tag">进度：${project.progress}%</span>
              <span class="tag">部门：${escapeHtml(project.department || "-")}</span>
            </div>
          </div>
          <small class="muted">${project.updates.length} 次项目更新</small>
        </header>
        <div class="mini-timeline">
          ${project.updates
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map((update) => `
              <div class="timeline-item" data-role-record-id="${update.id}">
                <strong>${escapeHtml(update.date)}</strong>
                <span>${escapeHtml(alleStageLabel(update.stage))} / ${update.progress}%</span>
                <p>${escapeHtml(update.summary)}</p>
              </div>
            `)
            .join("")}
        </div>
      </article>
    `)
    .join("");
  const recordCards = records.map((item) => {
    const user = userById(item.userId);
    const payload = item.payload || {};
    const summary =
      payload.current_result ||
      payload.business_value ||
      payload.research_conclusion ||
      payload.communication_result ||
      payload.what_was_learned ||
      payload.asset_description ||
      "-";
    const links = (item.evidence || [])
      .map((entry) => ({ href: normalizeLink(entry), label: String(entry || "").trim() }))
      .filter((entry) => entry.href);
    return `
      <article class="list-card" data-role-record-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml((roleRecordType?.querySelector(`option[value="${item.recordType}"]`) || {}).textContent || item.recordType)}</span>
              <span class="tag">成员：${escapeHtml(user?.name || item.userId)}</span>
              <span class="tag">日期：${escapeHtml(item.recordDate)}</span>
              ${item.relatedProject ? `<span class="tag">项目：${escapeHtml(item.relatedProject)}</span>` : ""}
            </div>
          </div>
          <small class="muted">${item.workHours || 0} 小时</small>
        </header>
        <p>${escapeHtml(summary)}</p>
        ${links.length ? `
          <div class="record-link-row">
            <span class="record-link-label">附件和成果链接</span>
            <div class="record-link-list">
              ${links.map((entry, index) => `<a class="record-link" href="${escapeHtml(entry.href)}" target="_blank" rel="noreferrer">打开链接 ${index + 1}</a>`).join("")}
            </div>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
  listNode.innerHTML = `
    ${projectCards ? `<div class="section-stack"><div class="panel-heading compact"><h3>项目时间线</h3></div>${projectCards}</div>` : ""}
    <div class="section-stack">
      <div class="panel-heading compact"><h3>最近记录</h3></div>
      ${recordCards || '<p class="empty-hint">当前还没有随时记录。</p>'}
    </div>
  `;
}

async function saveRoleRecord(event) {
  event.preventDefault();
  if (!roleRecordForm || !roleRecordFeedback) return;
  hideFeedback(roleRecordFeedback);
  await withSubmitState(roleRecordForm, "保存中...", async () => {
    const payload = buildRoleRecordPayload();
    const response = await apiFetch("/role-records", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showFeedback(roleRecordFeedback, "error", body.error || "随时记录保存失败，请稍后重试。");
      return;
    }
    roleRecordForm.reset();
    roleRecordDate.value = state.month ? `${state.month}-01` : "";
    renderRoleRecordFields();
    state.activeTab = "tasks";
    await loadBootstrap();
    showFeedback(roleRecordFeedback, "success", "随时记录已保存。");
    showToast("success", "随时记录已保存。");
  });
}

async function saveObjective(event) {
  event.preventDefault();
  const data = formDataObject(objectiveForm);
  const payload = {
    ...data,
    successCriteria: splitLines(data.successCriteria || ""),
    outOfScope: splitLines(data.outOfScope || ""),
  };
  const response = await apiFetch("/objectives", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return alert((await response.json()).error || "保存失败，请稍后重试。");
  objectiveForm.reset();
  monthInput.dispatchEvent(new Event("change"));
  await loadBootstrap();
}

async function saveUser(event) {
  event.preventDefault();
  hideFeedback(userFeedback);
  const payload = formDataObject(userForm);
  payload.roles = checkedValues(userForm, "roles");
  const response = await apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    showFeedback(userFeedback, "error", data.error || "新增成员失败，请稍后重试。");
    return;
  }
  userForm.reset();
  userForm.querySelector('input[name="roles"][value="employee"]').checked = true;
  userForm.elements.department.value = "AI部门";
  state.activeTab = "users";
  await loadBootstrap();
  showFeedback(userFeedback, "success", `成员已新增：${payload.name}。现在可以切换身份继续真实链路。`);
}

async function initializeSystem(event) {
  event.preventDefault();
  const payload = formDataObject(setupForm);
  payload.roles = checkedValues(setupForm, "roles");
  const response = await fetch(`${API_BASE}/system/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "初始化失败，请稍后重试。");
  state.viewerId = data.viewerId;
  localStorage.setItem(VIEWER_KEY, state.viewerId);
  state.activeTab = "users";
  await loadBootstrap();
}

async function saveResult(event) {
  event.preventDefault();
  const data = formDataObject(resultForm);
  const payload = {
    ...data,
    completionCriteria: splitLines(data.completionCriteria || ""),
  };
  const response = await apiFetch("/results", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return alert((await response.json()).error || "保存失败，请稍后重试。");
  resultForm.reset();
  await loadBootstrap();
}

async function saveTask(event) {
  event.preventDefault();
  const payload = formDataObject(taskForm);
  const response = await apiFetch("/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return alert((await response.json()).error || "保存失败，请稍后重试。");
  taskForm.reset();
  await loadBootstrap();
}

async function saveProgress(event) {
  event.preventDefault();
  const payload = formDataObject(progressForm);
  const taskId = payload.taskId;
  const response = await apiFetch(`/tasks/${taskId}/progress`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return alert((await response.json()).error || "保存失败，请稍后重试。");
  progressForm.reset();
  await loadBootstrap();
}

async function saveReview(event) {
  event.preventDefault();
  const payload = formDataObject(reviewForm);
  payload.markedForReview = reviewForm.querySelector('[name="markedForReview"]').checked;
  payload.markedAsAsset = reviewForm.querySelector('[name="markedAsAsset"]').checked;
  const response = await apiFetch("/reviews", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return alert((await response.json()).error || "保存失败，请稍后重试。");
  reviewForm.reset();
  await loadBootstrap();
}

async function generateReports() {
  const response = await apiFetch("/reports/generate", {
    method: "POST",
    body: JSON.stringify({ reportMonth: state.month }),
  });
  if (!response.ok) return alert((await response.json()).error || "月报生成失败，请稍后重试。");
  await loadBootstrap();
}

async function resetSystem() {
  const confirmed = window.confirm("这会清空当前目标、成果、事项、月报和测试身份，仅保留管理基础账号。确定继续吗？");
  if (!confirmed) return;
  const response = await apiFetch("/system/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) return alert((await response.json()).error || "清空失败，请稍后重试。");
  const data = await response.json();
  state.viewerId = data.viewerId || "";
  if (state.viewerId) {
    localStorage.setItem(VIEWER_KEY, state.viewerId);
  } else {
    localStorage.removeItem(VIEWER_KEY);
  }
  await loadBootstrap();
}

function activateTab(tabName) {
  const targetButton = tabButtons.find((button) => button.dataset.tab === tabName);
  if (!targetButton || targetButton.hidden) {
    const fallback = tabButtons.find((button) => !button.hidden);
    if (!fallback) return;
    tabName = fallback.dataset.tab;
  }
  state.activeTab = tabName;
  tabButtons.forEach((button) => {
    const isActive = !button.hidden && button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
  });
  tabPanels.forEach((panel) => {
    const isActive = !panel.hidden && panel.id === `tab-${tabName}`;
    panel.classList.toggle("active", isActive);
  });
}

function setSelectOptions(select, items, placeholderText, labelBuilder) {
  if (!select) return;
  const previousValue = select.value;
  if (!items.length) {
    select.innerHTML = `<option value="">${placeholderText}</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = items.map((item) => `<option value="${item.id}">${escapeHtml(labelBuilder(item))}</option>`).join("");
  if (items.some((item) => item.id === previousValue)) {
    select.value = previousValue;
  }
}

function withSubmitState(form, busyText, callback) {
  const button = form.querySelector('button[type="submit"]');
  setButtonBusy(button, true, busyText);
  return Promise.resolve()
    .then(callback)
    .finally(() => setButtonBusy(button, false));
}

loadBootstrap = async function loadBootstrapOverride() {
  setLoadingState(true);
  heroStatus.textContent = "加载中...";
  try {
    const response = await apiFetch(`/bootstrap?month=${encodeURIComponent(state.month)}&viewer_id=${encodeURIComponent(state.viewerId)}`, {
      method: "GET",
      headers: {},
    });
    if (!response.ok) {
      throw new Error("加载失败，请稍后重试。");
    }
    state.data = await response.json();
    const pendingAuthViewer = state.data.authRequestedViewer;
    if (!setupRequired() && state.data.viewer?.id && !pendingAuthViewer) {
      state.viewerId = state.data.viewer.id;
      if (userIsManagerLike(state.data.viewer)) {
        localStorage.removeItem(VIEWER_KEY);
        syncViewerUrl("");
      } else {
        localStorage.setItem(VIEWER_KEY, state.viewerId);
        syncViewerUrl(state.viewerId);
      }
    }
    if (pendingAuthViewer?.id) {
      state.viewerId = state.data.viewer?.id || "";
      localStorage.removeItem(VIEWER_KEY);
      syncViewerUrl("");
      state.data.authRequestedViewer = null;
    }
    heroStatus.textContent = "已同步";
    render();
  } catch (error) {
    if (!state.data) {
      heroStatus.textContent = "加载失败";
    }
    showToast("error", error?.message || "加载失败，请稍后重试。");
    console.error(error);
  } finally {
    setLoadingState(false);
  }
};

renderSelects = function renderSelectsOverride() {
  if (setupRequired()) {
    objectiveOwner.innerHTML = "";
    resultOwner.innerHTML = "";
    taskOwner.innerHTML = "";
    resultObjective.innerHTML = "";
    taskResult.innerHTML = "";
    progressTask.innerHTML = "";
    reviewAnalysis.innerHTML = '<option value="">请先初始化系统</option>';
    if (roleRecordOwner) roleRecordOwner.innerHTML = "";
    return;
  }

  const assignableUsers = state.data.users.filter((item) => item.roles.includes("employee") || item.roles.includes("supervisor") || item.roles.includes("admin"));
  setSelectOptions(objectiveOwner, assignableUsers, "请先新增成员", (user) => user.name);
  setSelectOptions(resultOwner, assignableUsers, "请先新增成员", (user) => user.name);
  setSelectOptions(taskOwner, assignableUsers, "请先新增成员", (user) => user.name);
  setSelectOptions(resultObjective, state.data.objectives, "请先创建目标", (item) => item.name);
  setSelectOptions(taskResult, state.data.results, "请先创建成果", (item) => item.name);
  setSelectOptions(progressTask, state.data.tasks, "请先创建事项", (item) => item.title);
  setSelectOptions(reviewAnalysis, state.data.pendingReviews, "当前没有待确认的 AI 判断", (item) => item.generatedText || `${item.targetType} ${item.targetId}`);
  if (roleRecordOwner) {
    setSelectOptions(roleRecordOwner, roleRecordOwnersForViewer(), "暂无可记录成员", (user) => `${user.name} / ${user.position || "-"}`);
  }
  if (roleRecordDate && !roleRecordDate.value) {
    roleRecordDate.value = `${state.month}-01`;
  }
  renderRoleRecordFields();
};

applyPermissions = function applyPermissionsOverride() {
  const canAdmin = viewerHasRole("admin");
  const canManager = isManagerLike();
  const canEmployee = isEmployeeLike();

  objectiveForm.querySelector("button").disabled = setupRequired() || !canAdmin || !selectHasRealOptions(objectiveOwner);
  userForm.querySelector("button").disabled = setupRequired() || !canAdmin;
  resetSystemButton.disabled = setupRequired() || !canAdmin;
  resultForm.querySelector("button").disabled = setupRequired() || !canEmployee || !selectHasRealOptions(resultObjective);
  taskForm.querySelector("button").disabled = setupRequired() || !canEmployee || !selectHasRealOptions(taskResult);
  progressForm.querySelector("button").disabled = setupRequired() || !canEmployee || !selectHasRealOptions(progressTask);
  reviewForm.querySelector("button").disabled = setupRequired() || !canManager || !selectHasRealOptions(reviewAnalysis);
  generateReportsButton.disabled = setupRequired() || !canManager;
  if (roleRecordForm) {
    const roleRecordButton = roleRecordForm.querySelector('button[type="submit"]');
    if (roleRecordButton) {
      roleRecordButton.disabled = setupRequired() || !selectHasRealOptions(roleRecordOwner) || !(isEmployeeLike() || canManager);
    }
  }
};

initializeSystem = async function initializeSystemOverride(event) {
  event.preventDefault();
  hideFeedback(setupFeedback);
  await withSubmitState(setupForm, "初始化中...", async () => {
    const payload = formDataObject(setupForm);
    payload.roles = checkedValues(setupForm, "roles");
    const response = await fetch(`${API_BASE}/system/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readResponseData(response);
    if (!response.ok) {
      showFeedback(setupFeedback, "error", data.error || "初始化失败，请稍后重试。");
      return;
    }
    state.viewerId = data.viewerId;
    localStorage.setItem(VIEWER_KEY, state.viewerId);
    state.activeTab = "users";
    await loadBootstrap();
    showToast("success", "真实测试环境已创建，可以开始录入成员和业务数据。");
  });
};

saveObjective = async function saveObjectiveOverride(event) {
  event.preventDefault();
  hideFeedback(objectiveFeedback);
  if (!selectHasRealOptions(objectiveOwner)) {
    showFeedback(objectiveFeedback, "error", "请先新增可分配成员。");
    state.activeTab = "users";
    activateTab("users");
    return;
  }
  await withSubmitState(objectiveForm, "保存中...", async () => {
    const data = formDataObject(objectiveForm);
    const payload = {
      ...data,
      successCriteria: splitLines(data.successCriteria || ""),
      outOfScope: splitLines(data.outOfScope || ""),
    };
    const response = await apiFetch("/objectives", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showFeedback(objectiveFeedback, "error", body.error || "目标保存失败，请稍后重试。");
      return;
    }
    if (body.objectiveId || body.id) setPendingFocus("objective", body.objectiveId || body.id);
    objectiveForm.reset();
    state.activeTab = "objectives";
    await loadBootstrap();
    showFeedback(objectiveFeedback, "success", `目标已保存：${payload.name}`);
    showToast("success", "目标创建成功。");
  });
};

saveUser = async function saveUserOverride(event) {
  event.preventDefault();
  hideFeedback(userFeedback);
  await withSubmitState(userForm, "新增中...", async () => {
    const payload = formDataObject(userForm);
    payload.roles = checkedValues(userForm, "roles");
    const response = await apiFetch("/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await readResponseData(response);
    if (!response.ok) {
      showFeedback(userFeedback, "error", data.error || "新增成员失败，请稍后重试。");
      return;
    }
    if (data.userId || data.id) setPendingFocus("user", data.userId || data.id);
    userForm.reset();
    userForm.querySelector('input[name="roles"][value="employee"]').checked = true;
    userForm.elements.department.value = "AI部门";
    state.activeTab = "users";
    await loadBootstrap();
    showFeedback(userFeedback, "success", `成员已新增：${payload.name}。现在可以切换这个身份继续走真实链路。`);
    showToast("success", `成员已新增：${payload.name}`);
  });
};

saveResult = async function saveResultOverride(event) {
  event.preventDefault();
  hideFeedback(resultFeedback);
  if (!selectHasRealOptions(resultObjective)) {
    showFeedback(resultFeedback, "error", "请先创建目标，再创建成果。");
    state.activeTab = "objectives";
    activateTab("objectives");
    return;
  }
  await withSubmitState(resultForm, "保存中...", async () => {
    const data = formDataObject(resultForm);
    const payload = {
      ...data,
      completionCriteria: splitLines(data.completionCriteria || ""),
    };
    const response = await apiFetch("/results", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showFeedback(resultFeedback, "error", body.error || "成果保存失败，请稍后重试。");
      return;
    }
    if (body.resultId || body.id) setPendingFocus("result", body.resultId || body.id);
    resultForm.reset();
    state.activeTab = "results";
    await loadBootstrap();
    showFeedback(resultFeedback, "success", `成果已保存：${payload.name}`);
    showToast("success", "成果创建成功。");
  });
};

saveTask = async function saveTaskOverride(event) {
  event.preventDefault();
  hideFeedback(taskFeedback);
  if (!selectHasRealOptions(taskResult)) {
    showFeedback(taskFeedback, "error", "请先创建成果，再记录事项。");
    state.activeTab = "results";
    activateTab("results");
    return;
  }
  await withSubmitState(taskForm, "保存中...", async () => {
    const payload = formDataObject(taskForm);
    const response = await apiFetch("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showFeedback(taskFeedback, "error", body.error || "事项保存失败，请稍后重试。");
      return;
    }
    if (body.taskId || body.id) setPendingFocus("task", body.taskId || body.id);
    taskForm.reset();
    state.activeTab = "tasks";
    await loadBootstrap();
    showFeedback(taskFeedback, "success", `事项已保存：${payload.title}`);
    showToast("success", "事项记录成功。");
  });
};

saveProgress = async function saveProgressOverride(event) {
  event.preventDefault();
  hideFeedback(progressFeedback);
  if (!selectHasRealOptions(progressTask)) {
    showFeedback(progressFeedback, "error", "请先创建事项，再追加进展。");
    return;
  }
  await withSubmitState(progressForm, "提交中...", async () => {
    const payload = formDataObject(progressForm);
    const response = await apiFetch(`/tasks/${payload.taskId}/progress`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showFeedback(progressFeedback, "error", body.error || "进展保存失败，请稍后重试。");
      return;
    }
    setPendingFocus("task", payload.taskId);
    progressForm.reset();
    state.activeTab = "tasks";
    await loadBootstrap();
    showFeedback(progressFeedback, "success", "进展已追加。");
    showToast("success", "事项进展已更新。");
  });
};

saveReview = async function saveReviewOverride(event) {
  event.preventDefault();
  hideFeedback(reviewFeedback);
  if (!selectHasRealOptions(reviewAnalysis)) {
    showFeedback(reviewFeedback, "error", "当前没有待确认的 AI 分析记录。");
    return;
  }
  await withSubmitState(reviewForm, "提交中...", async () => {
    const payload = formDataObject(reviewForm);
    payload.markedForReview = reviewForm.querySelector('[name="markedForReview"]').checked;
    payload.markedAsAsset = reviewForm.querySelector('[name="markedAsAsset"]').checked;
    const response = await apiFetch("/reviews", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showFeedback(reviewFeedback, "error", body.error || "主管确认提交失败，请稍后重试。");
      return;
    }
    reviewForm.reset();
    state.activeTab = "reviews";
    await loadBootstrap();
    showFeedback(reviewFeedback, "success", "主管确认已提交。");
    showToast("success", "AI分析已确认。");
  });
};

generateReports = async function generateReportsOverride() {
  const originalText = generateReportsButton.textContent;
  generateReportsButton.disabled = true;
  generateReportsButton.textContent = "生成中...";
  try {
    const response = await apiFetch("/reports/generate", {
      method: "POST",
      body: JSON.stringify({ reportMonth: state.month }),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showToast("error", body.error || "月报生成失败，请稍后重试。");
      return;
    }
    state.activeTab = "reports";
    await loadBootstrap();
    const latestReport = state.data?.monthlyReports?.filter((item) => item.reportMonth === state.month).at(-1);
    if (latestReport) {
      state.selectedReportId = latestReport.id;
      setPendingFocus("report", latestReport.id);
    }
    showToast("success", "本月月报已生成。");
  } finally {
    generateReportsButton.textContent = originalText;
    applyPermissions();
  }
};

async function confirmReport(reportId, payload, button) {
  setButtonBusy(button, true, "确认中...");
  try {
    const response = await apiFetch("/reports/confirm", {
      method: "POST",
      body: JSON.stringify({
        reportId,
        ...payload,
      }),
    });
    const body = await readResponseData(response);
    if (!response.ok) {
      showToast("error", body.error || "月报确认失败。");
      return;
    }
    state.activeTab = "reports";
    await loadBootstrap();
    state.selectedReportId = reportId;
    renderReports();
    showReport(reportId);
    showToast("success", "月报已确认。");
  } finally {
    setButtonBusy(button, false);
  }
}

resetSystem = async function resetSystemOverride() {
  const confirmed = window.confirm("这会清空当前目标、成果、事项、月报和测试成员数据，并重置为新的真实测试环境。确定继续吗？");
  if (!confirmed) return;
  const response = await apiFetch("/system/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const data = await readResponseData(response);
  if (!response.ok) {
    showToast("error", data.error || "重置失败，请稍后重试。");
    return;
  }
  state.viewerId = data.viewerId || "";
  state.selectedReportId = null;
  state.pendingFocus = null;
  if (state.viewerId) {
    localStorage.setItem(VIEWER_KEY, state.viewerId);
  } else {
    localStorage.removeItem(VIEWER_KEY);
  }
  state.activeTab = "users";
  await loadBootstrap();
  showToast("success", "系统已重置，可以重新开始真实测试。");
};

function interceptSubmit(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    await handler(event);
  }, true);
}

interceptSubmit(setupForm, initializeSystem);
interceptSubmit(objectiveForm, saveObjective);
interceptSubmit(userForm, saveUser);
interceptSubmit(resultForm, saveResult);
interceptSubmit(taskForm, saveTask);
interceptSubmit(progressForm, saveProgress);
interceptSubmit(reviewForm, saveReview);

refreshButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  await loadBootstrap();
}, true);

generateReportsButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  await generateReports();
}, true);

resetSystemButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  await resetSystem();
}, true);

activateTab = function activateTabOverride(tabName) {
  const targetButton = tabButtons.find((button) => button.dataset.tab === tabName);
  if (!targetButton || targetButton.hidden) {
    const fallback = tabButtons.find((button) => !button.hidden);
    if (!fallback) return;
    tabName = fallback.dataset.tab;
  }
  state.activeTab = tabName;
  rememberActiveTab(tabName);
  tabButtons.forEach((button) => {
    const isActive = !button.hidden && button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
  });
  tabPanels.forEach((panel) => {
    const isActive = !panel.hidden && panel.id === `tab-${tabName}`;
    panel.classList.toggle("active", isActive);
  });
  requestAnimationFrame(() => applyPendingFocus());
};

renderUsers = function renderUsersOverride() {
  userList.innerHTML = state.data.users
    .filter((item) => !item.roles.includes("ai_system"))
    .map((item) => `
      <article class="list-card" data-user-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(roleLabel(item))}</span>
              <span class="tag">${escapeHtml(item.position || "-")}</span>
            </div>
          </div>
        </header>
        <p>${escapeHtml(item.department)}</p>
      </article>
    `)
    .join("") || '<p class="empty-hint">暂无成员，请先新增真实组员。</p>';
};

renderObjectives = function renderObjectivesOverride() {
  document.getElementById("objectiveList").innerHTML = state.data.objectives.map((item) => {
    const owner = userById(item.ownerId);
    return `
      <article class="list-card" data-objective-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(objectiveStatusLabel(item.status))}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || item.ownerId)}</span>
              <span class="tag">来源：${escapeHtml(objectiveSourceLabel(item.sourceType))}</span>
              ${item.sourceDepartment ? `<span class="tag">发起部门：${escapeHtml(item.sourceDepartment)}</span>` : ""}
            </div>
          </div>
          <small class="muted">${escapeHtml(item.dueDate)}</small>
        </header>
        <p>${escapeHtml(item.description)}</p>
        ${item.sourceDetail ? `<p class="muted">发起说明：${escapeHtml(item.sourceDetail)}</p>` : ""}
        <div class="tag-row">${item.successCriteria.map((text) => `<span class="tag">${escapeHtml(text)}</span>`).join("")}</div>
      </article>
    `;
  }).join("") || '<p class="empty-hint">暂无目标，请先创建试点目标。</p>';
};

renderResults = function renderResultsOverride() {
  document.getElementById("resultList").innerHTML = state.data.results.map((item) => {
    const objective = objectiveById(item.objectiveId);
    const owner = userById(item.ownerId);
    return `
      <article class="list-card" data-result-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(resultStageLabel(item.stage))}</span>
              <span class="tag">目标：${escapeHtml(objective?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || item.ownerId)}</span>
            </div>
          </div>
          <small class="muted">${escapeHtml(item.dueDate)}</small>
        </header>
        <p>${escapeHtml(item.description)}</p>
        <div class="tag-row">${item.completionCriteria.map((text) => `<span class="tag">${escapeHtml(text)}</span>`).join("")}</div>
      </article>
    `;
  }).join("") || '<p class="empty-hint">暂无成果，请先为目标创建承接成果。</p>';
};

renderTasks = function renderTasksOverride() {
  const progressMap = new Map();
  for (const item of state.data.taskProgress) {
    if (!progressMap.has(item.taskId)) progressMap.set(item.taskId, []);
    progressMap.get(item.taskId).push(item);
  }

  document.getElementById("taskList").innerHTML = state.data.tasks.map((task) => {
    const result = resultById(task.resultId);
    const owner = userById(task.ownerId);
    const analysis = state.data.aiAnalysis.find((item) => item.targetType === "task" && item.targetId === task.id);
    const review = analysis ? latestReviewByAnalysis(analysis.id) : null;
    const progressItems = progressMap.get(task.id) || [];
    return `
      <article class="task-card" data-task-id="${task.id}">
        <header>
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(taskStatusLabel(task.currentStatus))}</span>
              <span class="tag">成果：${escapeHtml(result?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || task.ownerId)}</span>
            </div>
          </div>
          <small class="muted">累计 ${task.totalInputHours} 小时 / ${task.progressCount} 次进展</small>
        </header>
        <p>${escapeHtml(task.content)}</p>
        <div class="tag-row">
          <span class="tag">计划完成：${escapeHtml(task.plannedCompleteDate || "未填写")}</span>
          <span class="tag">跨月：${task.isCrossMonth ? "是" : "否"}</span>
          <span class="tag">延期：${task.isDelayed ? "是" : "否"}</span>
        </div>
        ${analysis ? `
          <div class="report-section">
            <strong>AI判断</strong>
            <p>${escapeHtml(analysis.generatedText || "")}</p>
            <div class="tag-row">
              <span class="tag">价值：${escapeHtml(analysis.valueLevel || "-")}</span>
              <span class="tag">效率：${escapeHtml(analysis.efficiencyJudgement || "-")}</span>
              <span class="tag">成长：${escapeHtml(analysis.growthLevel || "-")}</span>
              <span class="tag">风险：${escapeHtml(analysis.riskLevel || "-")}</span>
            </div>
            <small class="muted">${escapeHtml(analysis.reasoning)}</small>
            ${review ? `<p class="muted">主管状态：${escapeHtml(reviewStatusLabel(review.reviewStatus))}${review.comment ? ` / ${escapeHtml(review.comment)}` : ""}</p>` : ""}
          </div>
        ` : ""}
        ${progressItems.length ? `
          <div class="report-section">
            <strong>最新进展</strong>
            <ul>
              ${progressItems.slice(0, 3).map((item) => `<li>${escapeHtml(item.createdAt.slice(0, 10))} / ${escapeHtml(item.progressContent)} / ${item.inputHours}h</li>`).join("")}
            </ul>
          </div>
        ` : ""}
      </article>
    `;
  }).join("") || '<p class="empty-hint">暂无事项，请先记录第一条真实事项。</p>';
};

renderReviews = function renderReviewsOverride() {
  document.getElementById("pendingReviewList").innerHTML = state.data.pendingReviews.map((item) => {
    const task = taskById(item.targetId);
    return `
      <article class="list-card" data-review-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(task?.title || item.targetId)}</h3>
            <div class="meta-line">
              <span class="status-pill">待确认</span>
              <span class="tag">价值 ${escapeHtml(item.valueLevel || "-")}</span>
              <span class="tag">风险 ${escapeHtml(item.riskLevel || "-")}</span>
            </div>
          </div>
        </header>
        <p>${escapeHtml(item.generatedText || "")}</p>
        <small class="muted">${escapeHtml(item.reasoning)}</small>
      </article>
    `;
  }).join("") || '<p class="empty-hint">当前没有需要主管确认的 AI 分析。</p>';
};

showReport = function showReportOverride(reportId) {
  const report = state.data.monthlyReports.find((item) => item.id === reportId);
  if (!report) return;
  state.selectedReportId = reportId;
  const user = userById(report.userId);
  const content = report.aiGeneratedContent || {};
  const detail = document.getElementById("reportDetail");
  detail.innerHTML = `
    <h3>${escapeHtml(user?.name || report.userId)} / ${escapeHtml(report.reportMonth)} 月报</h3>
    <p class="muted">${escapeHtml(content.narrative || "")}</p>
    <section class="report-section">
      <strong>本月核心工作</strong>
      <ul>${(content.core_work || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>目标推进情况</strong>
      <ul>${(content.objective_progress || []).map((item) => `<li>${escapeHtml(item.name)} / ${formatPercent((item.progressRatio || 0) * 100)} / ${escapeHtml(item.status)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>成果完成情况</strong>
      <ul>${(content.result_progress || []).map((item) => `<li>${escapeHtml(item.name)} / ${escapeHtml(item.stage)} / 完成 ${item.completedTasks}/${item.taskCount}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>效率情况</strong>
      <ul>
        <li>事项完成率：${formatPercent(content.efficiency_summary?.completionRate)}</li>
        <li>上线/交付率：${formatPercent(content.efficiency_summary?.launchRate)}</li>
        <li>累计投入时长：${content.efficiency_summary?.totalInputHours || 0} 小时</li>
      </ul>
    </section>
    <section class="report-section">
      <strong>价值与成长</strong>
      <ul>
        <li>价值类型：${escapeHtml((content.value_output || []).join("、") || "暂无")}</li>
        <li>能力成长：${escapeHtml((content.ability_growth || []).join("、") || "暂无")}</li>
      </ul>
    </section>
    <section class="report-section">
      <strong>问题与风险</strong>
      <ul>${(content.risks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>下月重点</strong>
      <ul>${(content.next_month_focus || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
  `;
};

renderReports = function renderReportsOverride() {
  const currentReports = state.data.monthlyReports.filter((item) => item.reportMonth === state.month);
  document.getElementById("reportList").innerHTML = currentReports
    .map((item) => {
      const user = userById(item.userId);
      return `
        <article class="list-card report-entry ${state.selectedReportId === item.id ? "is-selected" : ""}" data-report-id="${item.id}">
          <header>
            <div>
              <h3>${escapeHtml(user?.name || item.userId)}</h3>
              <div class="meta-line">
                <span class="status-pill">${escapeHtml(item.reportStatus)}</span>
                <span class="tag">${escapeHtml(item.reportMonth)}</span>
              </div>
            </div>
          </header>
          <p>${escapeHtml(item.aiGeneratedContent?.narrative || "暂无摘要")}</p>
        </article>
      `;
    }).join("") || '<p class="empty-hint">本月还没有生成月报。</p>';

  document.querySelectorAll(".report-entry").forEach((node) => {
    node.addEventListener("click", () => showReport(node.dataset.reportId));
  });

  const targetReport =
    currentReports.find((item) => item.id === state.selectedReportId) ||
    currentReports[0];

  if (targetReport) {
    showReport(targetReport.id);
  } else {
    state.selectedReportId = null;
    document.getElementById("reportDetail").innerHTML = '<p class="empty-hint">请选择一份月报查看结构化内容。</p>';
  }
};

renderSelects = function renderSelectsScopedOverride() {
  if (setupRequired()) {
    objectiveOwner.innerHTML = "";
    resultOwner.innerHTML = "";
    taskOwner.innerHTML = "";
    resultObjective.innerHTML = "";
    taskResult.innerHTML = "";
    progressTask.innerHTML = "";
    reviewAnalysis.innerHTML = '<option value="">请先完成初始化</option>';
    if (roleRecordOwner) roleRecordOwner.innerHTML = "";
    return;
  }

  const assignableUsers = assignableUsersForViewer();
  setSelectOptions(objectiveOwner, assignableUsers, "暂无可分配成员", (user) => user.name);
  setSelectOptions(resultOwner, assignableUsers, "暂无可分配成员", (user) => user.name);
  setSelectOptions(taskOwner, assignableUsers, "暂无可分配成员", (user) => user.name);
  setSelectOptions(resultObjective, visibleObjectives(), "暂无可见目标", (item) => item.name);
  setSelectOptions(taskResult, visibleResults(), "暂无可见成果", (item) => item.name);
  setSelectOptions(progressTask, visibleTasks(), "暂无可见事项", (item) => item.title);
  setSelectOptions(reviewAnalysis, state.data.pendingReviews, "暂无待确认AI判断", (item) => item.generatedText || `${item.targetType} ${item.targetId}`);
  if (roleRecordOwner) {
    setSelectOptions(roleRecordOwner, roleRecordOwnersForViewer(), "暂无可记录成员", (user) => `${user.name} / ${user.position || "-"}`);
  }
  if (roleRecordDate && !roleRecordDate.value) {
    roleRecordDate.value = `${state.month}-01`;
  }
  renderRoleRecordFields();
};

renderResults = function renderResultsScopedOverride() {
  const results = visibleResults();
  document.getElementById("resultList").innerHTML = results.map((item) => {
    const objective = objectiveById(item.objectiveId);
    const owner = userById(item.ownerId);
    return `
      <article class="list-card" data-result-id="${item.id}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(resultStageLabel(item.stage))}</span>
              <span class="tag">目标：${escapeHtml(objective?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || item.ownerId)}</span>
            </div>
          </div>
          <small class="muted">${escapeHtml(item.dueDate || "未设置截止日期")}</small>
        </header>
        <p>${escapeHtml(item.description)}</p>
        <div class="tag-row">${item.completionCriteria.map((text) => `<span class="tag">${escapeHtml(text)}</span>`).join("")}</div>
      </article>
    `;
  }).join("") || '<p class="empty-hint">当前身份下暂无可查看成果。</p>';
};

renderTasks = function renderTasksScopedOverride() {
  renderRoleRecordList();
  const roleRecordPanel = roleRecordForm?.closest(".panel");
  const genericTaskPanel = taskForm?.closest(".panel");
  const progressPanel = progressForm?.closest(".panel");
  const taskListPanel = document.getElementById("taskList")?.closest(".panel");
  const alleOnlyMode = isAlleViewer();
  if (roleRecordPanel) roleRecordPanel.hidden = !alleOnlyMode && !isManagerLike();
  if (genericTaskPanel) genericTaskPanel.hidden = alleOnlyMode;
  if (progressPanel) progressPanel.hidden = alleOnlyMode;
  if (taskListPanel) taskListPanel.hidden = alleOnlyMode;
  if (alleOnlyMode) {
    applyPendingFocus();
    return;
  }
  const progressMap = new Map();
  for (const item of state.data.taskProgress) {
    if (!progressMap.has(item.taskId)) progressMap.set(item.taskId, []);
    progressMap.get(item.taskId).push(item);
  }

  const tasks = visibleTasks();
  document.getElementById("taskList").innerHTML = tasks.map((task) => {
    const result = resultById(task.resultId);
    const owner = userById(task.ownerId);
    const analysis = state.data.aiAnalysis.find((item) => item.targetType === "task" && item.targetId === task.id);
    const review = analysis ? latestReviewByAnalysis(analysis.id) : null;
    const progressItems = progressMap.get(task.id) || [];
    return `
      <article class="task-card" data-task-id="${task.id}">
        <header>
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(taskStatusLabel(task.currentStatus))}</span>
              <span class="tag">成果：${escapeHtml(result?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || task.ownerId)}</span>
            </div>
          </div>
          <small class="muted">累计 ${task.totalInputHours} 小时 / ${task.progressCount} 次进展</small>
        </header>
        <p>${escapeHtml(task.content)}</p>
        <div class="tag-row">
          <span class="tag">计划完成：${escapeHtml(task.plannedCompleteDate || "未设置")}</span>
          <span class="tag">跨月事项：${yesNoLabel(task.isCrossMonth)}</span>
          <span class="tag">延期风险：${yesNoLabel(task.isDelayed)}</span>
        </div>
        ${analysis ? `
          <div class="report-section">
            <strong>AI分析</strong>
            <p>${escapeHtml(analysis.generatedText || "")}</p>
            <div class="tag-row">
              <span class="tag">工作分类：${escapeHtml((analysis.workCategory || []).join("、") || "-")}</span>
              <span class="tag">价值等级：${escapeHtml(analysis.valueLevel || "-")}</span>
              <span class="tag">效率判断：${escapeHtml(efficiencyLabel(analysis.efficiencyJudgement))}</span>
              <span class="tag">成长层级：${escapeHtml(analysis.growthLevel || "-")}</span>
              <span class="tag">风险判断：${escapeHtml(riskLevelLabel(analysis.riskLevel))}</span>
            </div>
            <small class="muted">${escapeHtml(analysis.reasoning)}</small>
            ${review ? `<p class="muted">主管确认：${escapeHtml(reviewStatusLabel(review.reviewStatus))}${review.comment ? ` / ${escapeHtml(review.comment)}` : ""}</p>` : ""}
          </div>
        ` : ""}
        ${progressItems.length ? `
          <div class="report-section">
            <strong>最新进展</strong>
            <ul>
              ${progressItems.slice(0, 3).map((item) => `<li>${escapeHtml(item.createdAt.slice(0, 10))} / ${escapeHtml(item.progressContent)} / ${item.inputHours}小时</li>`).join("")}
            </ul>
          </div>
        ` : ""}
      </article>
    `;
  }).join("") || '<p class="empty-hint">当前身份下暂无可查看事项。</p>';
};

showReport = function showReportScopedOverride(reportId) {
  const report = visibleReports().find((item) => item.id === reportId);
  if (!report) return;
  state.selectedReportId = reportId;
  const user = userById(report.userId);
  const confirmer = userById(report.confirmedBy);
  const content = report.aiGeneratedContent || {};
  const finalContent = report.finalContent || {};
  const employeeView = finalContent.employeeView || content.employee_view || {};
  const detail = document.getElementById("reportDetail");

  if ((finalContent.reportTemplate || content.report_template) === "alle_monthly") {
    const managementView = finalContent.managementView || content.management_view || {};
    const projectRows = (content.project_groups || []).map((item) => [
      item.projectName || "-",
      item.department || "-",
      alleStageLabel(item.currentStage),
      `${item.progressPercent || 0}%`,
      (item.currentResults || []).join("；") || "-",
      (item.problems || []).join("；") || "-",
      (item.nextActions || []).join("；") || "-",
    ]);
    const efficiencyRows = (content.efficiency_rows || []).map((item) => [
      item.project || "-",
      item.department || "-",
      item.usageStatus || "-",
      item.timeBefore || "-",
      item.timeAfter || "-",
      item.monthlyFrequency || "-",
      item.savedHours || "-",
      item.businessValue || "-",
    ]);
    const assetRows = (content.asset_rows || []).map((item) => [
      item.assetName || "-",
      item.assetType || "-",
      item.relatedProject || "-",
      item.reusable ? "是" : "否",
      item.usageScope || "-",
      item.storageLocation || "-",
    ]);
    const researchRows = (content.research_rows || []).map((item) => [
      item.toolName || "-",
      item.scenario || "-",
      item.problemToSolve || "-",
      item.researchConclusion || "-",
      item.cost || "-",
      item.recommendedAction || "-",
    ]);
    const otherRows = (content.other_rows || []).map((item) => [
      item.title || "-",
      item.department || "-",
      item.relatedProject || "-",
      item.summary || "-",
      item.businessValue || "-",
      item.nextAction || "-",
    ]);
    const requirementRows = (content.requirement_rows || []).map((item) => [
      item.requestDescription || "-",
      item.requestDepartment || "-",
      item.realBusinessProblem || "-",
      item.isSuitableForRpa || "-",
      item.decision || "-",
      item.reason || "-",
    ]);
    const riskRows = (content.risk_rows || []).map((item) => [
      item.category || "-",
      item.problem || "-",
      item.impact || "-",
      item.action || "-",
      item.needSupport || "-",
      item.due || "-",
    ]);
    const nextPlanRows = (content.next_plan_rows || []).map((item) => [
      item.priority || "-",
      item.item || "-",
      item.targetResult || "-",
      item.milestone || "-",
      item.acceptance || "-",
    ]);
    const dimensionRows = content.full_dimension_table || [];
    const capabilityRows = (content.capability_rows || []).map((item) => [
      item.capabilityName || "-",
      item.relatedProject || "-",
      item.testResult || item.learned || "-",
      item.moduleCreated ? "是" : "否",
      item.documentLink || "-",
    ]);
    const projectTimelineCards = (content.project_groups || []).map((item) => `
      <article class="list-card">
        <header>
          <div>
            <h3>${escapeHtml(item.projectName || "-")}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(alleStageLabel(item.currentStage))}</span>
              <span class="tag">进度：${item.progressPercent || 0}%</span>
              <span class="tag">级别：${escapeHtml(item.projectLevel || "-")}</span>
            </div>
          </div>
        </header>
        <div class="mini-timeline">
          ${(item.timeline || []).map((node) => `
            <div class="timeline-item">
              <strong>${escapeHtml(node.recordDate || "-")}</strong>
              <span>${escapeHtml(node.stageLabel || "-")} / ${node.progressPercent || 0}%</span>
              <p>${escapeHtml(node.completedToday || node.currentResult || node.problemOrRisk || "已记录项目更新")}</p>
            </div>
          `).join("") || '<p class="empty-hint">暂无项目时间线。</p>'}
        </div>
      </article>
    `).join("");

    if (!isManagerLike()) {
      const progressRows = (employeeView.workProgress || []).map((item) => [
        item.taskTitle || "-",
        item.status || "-",
        `${item.progressCount || 0}次`,
        item.lastProgressAt || "-",
      ]);
      detail.innerHTML = `
        <h3>${escapeHtml(user?.name || report.userId)} / ${escapeHtml(report.reportMonth)} 员工月报</h3>
        <p class="muted">${escapeHtml(content.narrative || "")}</p>
        <section class="report-section">
          <strong>员工月报总表</strong>
          ${renderSummaryTable([
            ["工作时长", `${employeeView.workHours || 0} 小时`],
            ["工作进度记录", `${employeeView.totalProgressCount || 0} 条`],
            ["完成事项", `${(employeeView.completedItems || []).length} 项`],
            ["未完成事项", `${(employeeView.pendingItems || []).length} 项`],
          ], ["维度", "内容"])}
        </section>
        <section class="report-section">
          <strong>工作进度情况</strong>
          ${renderSummaryTable(progressRows, ["事项", "当前状态", "进展次数", "最近更新"])}
        </section>
        <section class="report-section">
          <strong>工作内容链接</strong>
          <div class="table-wrap">
            <table>
              <thead><tr><th>记录名称</th><th>记录类型</th><th>入口</th></tr></thead>
              <tbody>
                ${(employeeView.workContentLinks || []).map((item) => `
                  <tr>
                    <td>${escapeHtml(item.taskTitle || "-")}</td>
                    <td>${escapeHtml(item.resultName || "-")}</td>
                    <td><button class="inline-link-button" type="button" data-nav-tab="tasks" data-focus-type="role_record" data-focus-id="${escapeHtml(item.recordId || "")}">查看记录</button></td>
                  </tr>
                `).join("") || '<tr><td colspan="3">暂无记录。</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
        <section class="report-section">
          <strong>完成事项</strong>
          <ul>${(employeeView.completedItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
        </section>
        <section class="report-section">
          <strong>未完成事项</strong>
          <ul>${(employeeView.pendingItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
        </section>
      `;
      bindDashboardNavigation();
      return;
    }

    const overviewMetrics = managementView.overviewMetrics || {};
    detail.innerHTML = `
      <h3>${escapeHtml(user?.name || report.userId)} / ${escapeHtml(report.reportMonth)} 阿勒管理月报</h3>
      <p class="muted">${escapeHtml(finalContent.approvedNarrative || content.narrative || "")}</p>
      <section class="report-section">
        <strong>月报总维度表</strong>
        ${renderSummaryTable(dimensionRows, ["模块", "对象", "维度", "内容"])}
      </section>
      <section class="report-section">
        <strong>概览统计</strong>
        ${renderSummaryTable([
          ["本月记录数", `${overviewMetrics.recordCount || 0} 条`],
          ["重点项目数", `${overviewMetrics.projectCount || 0} 个`],
          ["上线/部分使用项目", `${overviewMetrics.launchedProjectCount || 0} 个`],
          ["稳定使用项目", `${overviewMetrics.stableProjectCount || 0} 个`],
          ["试用中项目", `${overviewMetrics.trialProjectCount || 0} 个`],
          ["覆盖部门数", `${overviewMetrics.coveredDepartmentCount || 0} 个`],
          ["覆盖使用人数", `${overviewMetrics.coveredUsersCount || 0} 人`],
          ["预计节省工时", `${overviewMetrics.savedHoursTotal || 0} 小时`],
          ["建议评价等级", `${content.suggested_grade || "-"}`],
        ], ["指标", "本月情况"])}
      </section>
      <section class="report-section">
        <strong>本月重点影刀项目</strong>
        ${renderSummaryTable(projectRows, ["项目名称", "所属部门", "当前阶段", "进度", "当前结果", "问题或风险", "下一步动作"])}
      </section>
      <section class="report-section">
        <strong>项目时间线</strong>
        ${projectTimelineCards || '<p class="empty-hint">暂无项目时间线。</p>'}
      </section>
      <section class="report-section">
        <strong>本月效率改善结果</strong>
        ${renderSummaryTable(efficiencyRows, ["项目", "使用部门", "使用状态", "原耗时", "现耗时", "月度频次", "预计节省工时", "业务价值"])}
      </section>
      <section class="report-section">
        <strong>影刀能力学习</strong>
        ${renderSummaryTable(capabilityRows, ["能力名称", "关联项目", "测试/学习结果", "形成模块", "文档链接"])}
      </section>
      <section class="report-section">
        <strong>影刀能力与资产沉淀</strong>
        ${renderSummaryTable(assetRows, ["资产名称", "资产类型", "关联项目", "可复用", "适用范围", "存放位置"])}
      </section>
      <section class="report-section">
        <strong>内容AI与专业工具研究</strong>
        ${renderSummaryTable(researchRows, ["工具", "研究场景", "要解决的问题", "研究结论", "成本", "建议动作"])}
      </section>
      <section class="report-section">
        <strong>其他补充事项</strong>
        ${renderSummaryTable(otherRows, ["标题", "所属部门", "关联项目", "摘要", "业务价值", "下一步动作"])}
      </section>
      <section class="report-section">
        <strong>需求判断与跨部门推进</strong>
        ${renderSummaryTable(requirementRows, ["需求", "部门", "真实业务问题", "适合影刀", "处理决定", "判断理由"])}
      </section>
      <section class="report-section">
        <strong>本月问题与风险</strong>
        ${renderSummaryTable(riskRows, ["分类", "问题", "影响", "当前处理方式", "需要协助", "预计解决时间"])}
      </section>
      <section class="report-section">
        <strong>下月工作计划</strong>
        ${renderSummaryTable(nextPlanRows, ["优先级", "工作事项", "目标结果", "计划节点", "验收标准"])}
      </section>
      <section class="report-section">
        <strong>主管操作</strong>
        ${report.reportStatus === "confirmed" ? `
          <p class="muted">该月报已确认。</p>
          ${report.supervisorComment ? `<p class="muted">确认结论：${escapeHtml(report.supervisorComment)}</p>` : ""}
          ${finalContent.managerEvaluation ? `<p class="muted">管理者评价：${escapeHtml(finalContent.managerEvaluation)}</p>` : ""}
          ${finalContent.managerScore !== undefined && finalContent.managerScore !== null && finalContent.managerScore !== "" ? `<p class="muted">管理评分：${escapeHtml(String(finalContent.managerScore))} 分</p>` : ""}
        ` : `
          <label class="stack-field">
            <span>管理者修订摘要</span>
            <textarea id="approvedNarrative" rows="5" placeholder="可以直接修订自动生成的工作概述...">${escapeHtml(finalContent.approvedNarrative || content.narrative || "")}</textarea>
          </label>
          <label class="stack-field">
            <span>自我总结</span>
            <textarea id="selfSummary" rows="4" placeholder="补充阿勒本月自我总结...">${escapeHtml(finalContent.selfSummary || content.self_summary || "")}</textarea>
          </label>
          <label class="stack-field">
            <span>主管确认说明</span>
            <textarea id="reportSupervisorComment" rows="4" placeholder="填写确认意见、修正说明或管理评价...">${escapeHtml(report.supervisorComment || "")}</textarea>
          </label>
          <div class="grid two-col">
            <label class="stack-field">
              <span>管理者评价</span>
              <textarea id="managerEvaluation" rows="4" placeholder="填写最终管理评价...">${escapeHtml(finalContent.managerEvaluation || content.manager_evaluation || "")}</textarea>
            </label>
            <label class="stack-field">
              <span>管理评分</span>
              <input id="managerScore" type="number" min="0" max="100" value="${escapeHtml(finalContent.managerScore ?? "")}" placeholder="如需量化，可填写 0-100 分">
              <small class="muted">建议等级：${escapeHtml(content.suggested_grade || "-")}</small>
            </label>
          </div>
          <div class="toolbar-actions">
            <button class="primary-button" id="confirmReportButton" type="button">确认本月报</button>
          </div>
        `}
      </section>
    `;
    const confirmButton = document.getElementById("confirmReportButton");
    if (confirmButton) {
      confirmButton.addEventListener("click", async () => {
        const commentField = document.getElementById("reportSupervisorComment");
        await confirmReport(
          report.id,
          {
            supervisorComment: commentField?.value || "",
            approvedNarrative: document.getElementById("approvedNarrative")?.value || "",
            selfSummary: document.getElementById("selfSummary")?.value || "",
            managerEvaluation: document.getElementById("managerEvaluation")?.value || "",
            managerScore: document.getElementById("managerScore")?.value || "",
          },
          confirmButton,
        );
      });
    }
    bindDashboardNavigation();
    return;
  }

  const monthSummaryRows = [
    ["核心工作", (content.core_work || []).join("；") || "-"],
    ["工作分类", (content.work_categories || []).map((item) => `${item.label}（${item.count}）`).join("、") || "-"],
    ["能力标签", (content.ability_tags_summary || []).map((item) => `${item.label}（${item.count}）`).join("、") || "-"],
    ["价值类型", (content.value_types_summary || []).map((item) => `${item.label}（${item.count}）`).join("、") || "-"],
    ["价值等级", (content.value_levels_summary || []).map((item) => `${item.label}（${item.count}）`).join("、") || "-"],
    ["效率判断", (content.efficiency_judgements_summary || []).map((item) => `${efficiencyLabel(item.label)}（${item.count}）`).join("、") || "-"],
    ["风险类型", (content.risk_types_summary || []).map((item) => `${item.label}（${item.count}）`).join("、") || "-"],
    ["风险判断", (content.risk_levels_summary || []).map((item) => `${riskLevelLabel(item.label)}（${item.count}）`).join("、") || "-"],
    ["成长层级", (content.growth_levels_summary || []).map((item) => `${item.label}（${item.count}）`).join("、") || "-"],
    ["事项完成率", formatPercent(content.efficiency_summary?.completionRate)],
    ["上线/交付率", formatPercent(content.efficiency_summary?.launchRate)],
    ["累计投入时长", `${content.efficiency_summary?.totalInputHours || 0}小时`],
    ["工期跨度汇总", `${content.efficiency_summary?.totalDurationDays || 0}天`],
    ["进展追加次数", `${content.efficiency_summary?.totalProgressCount || 0}次`],
    ["风险与问题", (content.risks || []).join("、") || "-"],
    ["下月计划", (content.next_month_focus || []).join("；") || "-"],
  ];
  const objectiveRows = (content.objective_progress || []).map((item) => [
    item.name,
    objectiveStatusLabel(item.status),
    formatPercent((item.progressRatio || 0) * 100),
  ]);
  const resultRows = (content.result_progress || []).map((item) => [
    item.name,
    resultStageLabel(item.stage),
    `${item.completedTasks}/${item.taskCount}`,
    formatPercent((item.progressRatio || 0) * 100),
  ]);
  const taskAnalysisRows = (content.task_analysis_table || []).map((item) => [
    item.taskTitle,
    item.resultName || "-",
    taskStatusLabel(item.status),
    `${item.hours || 0}小时`,
    `${item.durationDays || 0}天`,
    `${item.progressCount || 0}次`,
    (item.workCategory || []).join("、") || "-",
    (item.abilityTags || []).join("、") || "-",
    (item.valueTypes || []).join("、") || "-",
    item.valueLevel || "-",
    efficiencyLabel(item.efficiencyJudgement),
    (item.riskTypes || []).join("、") || "-",
    riskLevelLabel(item.riskLevel),
    item.growthLevel || "-",
    yesNoLabel(item.needsManagerReview),
    reviewStatusLabel(item.reviewStatus),
  ]);
  const supervisorRows = (content.manager_review_summary || []).map((item) => [
    item.taskTitle,
    reviewStatusLabel(item.reviewStatus),
    item.valueLevel || "-",
    efficiencyLabel(item.efficiency),
    riskLevelLabel(item.riskLevel),
    item.comment || "-",
    item.nextStepSuggestion || "-",
  ]);
  if (!isManagerLike()) {
    const progressRows = (employeeView.workProgress || []).map((item) => [
      item.taskTitle || "-",
      taskStatusLabel(item.status),
      `${item.progressCount || 0}次`,
      item.lastProgressAt ? item.lastProgressAt.slice(0, 10) : "-",
    ]);
    detail.innerHTML = `
      <h3>${escapeHtml(user?.name || report.userId)} / ${escapeHtml(report.reportMonth)} 员工月报</h3>
      <p class="muted">${escapeHtml(content.narrative || "")}</p>
      <section class="report-section">
        <strong>员工月报总表</strong>
        ${renderSummaryTable([
          ["工作时长", `${employeeView.workHours || 0}小时`],
          ["工期跨度", `${employeeView.totalDurationDays || 0}天`],
          ["进展追加次数", `${employeeView.totalProgressCount || 0}次`],
          ["完成事项", `${(employeeView.completedItems || []).length}项`],
          ["未完成事项", `${(employeeView.pendingItems || []).length}项`],
        ], ["维度", "内容"])}
      </section>
      <section class="report-section">
        <strong>工作进度情况</strong>
        ${renderSummaryTable(progressRows, ["事项", "当前状态", "进展次数", "最近更新"])}
      </section>
      <section class="report-section">
        <strong>工作内容链接</strong>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>事项</th><th>关联成果</th><th>链接</th></tr>
            </thead>
            <tbody>
              ${(employeeView.workContentLinks || []).map((item) => `
                <tr>
                  <td>${escapeHtml(item.taskTitle || "-")}</td>
                  <td>${escapeHtml(item.resultName || "-")}</td>
                  <td><button class="inline-link-button" type="button" data-nav-tab="tasks" data-focus-type="task" data-focus-id="${escapeHtml(item.taskId)}">查看事项</button></td>
                </tr>
              `).join("") || '<tr><td colspan="3">暂无可跳转内容。</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
      <section class="report-section">
        <strong>完成事项</strong>
        <ul>${(employeeView.completedItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
      </section>
      <section class="report-section">
        <strong>未完成事项</strong>
        <ul>${(employeeView.pendingItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
      </section>
    `;
    bindDashboardNavigation();
    return;
  }

  detail.innerHTML = `
    <h3>${escapeHtml(user?.name || report.userId)} / ${escapeHtml(report.reportMonth)} 月报</h3>
    <p class="muted">${escapeHtml(content.narrative || "")}</p>
    <section class="report-section">
      <strong>月报状态</strong>
      ${renderSummaryTable([
        ["状态", reportStatusLabel(report.reportStatus)],
        ["生成时间", (report.generatedAt || "").replace("T", " ") || "-"],
        ["确认人", confirmer?.name || report.confirmedBy || "-"],
        ["确认时间", (report.confirmedAt || "").replace("T", " ") || "-"],
      ], ["字段", "内容"])}
      ${report.supervisorComment ? `<p class="muted">主管备注：${escapeHtml(report.supervisorComment)}</p>` : ""}
    </section>
    ${report.reportStatus === "confirmed" ? `
      <section class="report-section">
        <strong>确认版摘要</strong>
        <p>${escapeHtml(finalContent.approvedNarrative || content.narrative || "")}</p>
        ${finalContent.supervisorComment ? `<p class="muted">确认结论：${escapeHtml(finalContent.supervisorComment)}</p>` : ""}
      </section>
    ` : ""}
    <section class="report-section">
      <strong>月报总表</strong>
      ${renderSummaryTable(monthSummaryRows, ["月报维度", "本月情况"])}
      ${content.efficiency_summary?.abnormalTasks?.length ? `
        <p class="muted">异常关注事项：${escapeHtml(content.efficiency_summary.abnormalTasks.join("、"))}</p>
      ` : ""}
    </section>
    <section class="report-section">
      <strong>目标推进情况</strong>
      ${renderSummaryTable(objectiveRows, ["目标", "状态", "推进率"])}
    </section>
    <section class="report-section">
      <strong>成果推进情况</strong>
      ${renderSummaryTable(resultRows, ["成果", "阶段", "完成事项", "阶段进度"])}
    </section>
    <section class="report-section">
      <strong>主管确认与修正</strong>
      ${renderSummaryTable(supervisorRows, ["事项", "确认状态", "价值等级", "效率判断", "风险判断", "主管备注", "下一步建议"])}
    </section>
    <section class="report-section">
      <strong>事项维度总表</strong>
      ${renderSummaryTable(taskAnalysisRows, ["事项", "关联成果", "状态", "时长", "工期", "进展", "工作分类", "能力标签", "价值类型", "价值等级", "效率判断", "风险类型", "风险判断", "成长层级", "需主管确认", "确认状态"])}
    </section>
    ${isManagerLike() ? `
      <section class="report-section">
        <strong>主管操作</strong>
        ${report.reportStatus === "confirmed" ? `
          <p class="muted">该月报已确认，可直接用于管理查看与后续沉淀。</p>
        ` : `
          <label class="stack-field">
            <span>主管确认说明</span>
            <textarea id="reportSupervisorComment" rows="4" placeholder="填写确认结论、修正说明或补充建议...">${escapeHtml(report.supervisorComment || "")}</textarea>
          </label>
          <div class="toolbar-actions">
            <button class="primary-button" id="confirmReportButton" type="button">确认本月报</button>
          </div>
        `}
      </section>
    ` : ""}
  `;

  const confirmButton = document.getElementById("confirmReportButton");
  if (confirmButton) {
    confirmButton.addEventListener("click", async () => {
      const commentField = document.getElementById("reportSupervisorComment");
      await confirmReport(report.id, { supervisorComment: commentField?.value || "" }, confirmButton);
    });
  }
  bindDashboardNavigation();
};

renderReports = function renderReportsScopedOverride() {
  const currentReports = visibleReports();
  document.getElementById("reportList").innerHTML = currentReports
    .map((item) => {
      const user = userById(item.userId);
      const statusLabel = reportStatusLabel(item.reportStatus);
      return `
        <article class="list-card report-entry ${state.selectedReportId === item.id ? "is-selected" : ""}" data-report-id="${item.id}">
          <header>
            <div>
              <h3>${escapeHtml(user?.name || item.userId)}</h3>
              <div class="meta-line">
                <span class="status-pill">${escapeHtml(statusLabel)}</span>
                <span class="tag">${escapeHtml(item.reportMonth)}</span>
                ${item.confirmedAt ? `<span class="tag">${escapeHtml(item.confirmedAt.slice(0, 10))}</span>` : ""}
              </div>
            </div>
          </header>
          <p>${escapeHtml(item.aiGeneratedContent?.narrative || "暂无摘要")}</p>
          ${item.supervisorComment ? `<small class="muted">${escapeHtml(item.supervisorComment)}</small>` : ""}
        </article>
      `;
    }).join("") || '<p class="empty-hint">当前身份下暂无可查看月报。</p>';

  document.querySelectorAll(".report-entry").forEach((node) => {
    node.addEventListener("click", () => showReport(node.dataset.reportId));
  });

  const targetReport =
    currentReports.find((item) => item.id === state.selectedReportId) ||
    currentReports[0];

  if (targetReport) {
    showReport(targetReport.id);
  } else {
    state.selectedReportId = null;
    document.getElementById("reportDetail").innerHTML = '<p class="empty-hint">请选择一份月报查看详细内容。</p>';
  }
};

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

async function switchIdentity(targetUserId) {
  const targetUser = (state.data?.users || []).find((item) => item.id === targetUserId);
  if (!targetUser) return;

  if (requiresAuthCode(targetUser)) {
    openAuthModal(targetUser);
    return;
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    state.viewerId = targetUserId;
  }

  localStorage.setItem(VIEWER_KEY, state.viewerId);
  syncViewerUrl(state.viewerId);
  await loadBootstrap();
}

viewerSelect.addEventListener("change", async () => {
  await switchIdentity(viewerSelect.value);
});

authCancelButton?.addEventListener("click", () => {
  viewerSelect.value = state.viewerId;
  closeAuthModal();
});

authDismissButton?.addEventListener("click", () => {
  viewerSelect.value = state.viewerId;
  closeAuthModal();
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const targetUserId = state.pendingAuthUserId;
  if (!targetUserId) {
    closeAuthModal();
    return;
  }
  setButtonBusy(authConfirmButton, true, "验证中...");
  try {
    const response = await fetch(`${API_BASE}/auth/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, accessCode: authCodeInput.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) {
      showToast("error", data.error || "身份验证失败。");
      return;
    }
    localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
    state.viewerId = data.viewerId;
    if (userIsManagerLike(data.viewer)) {
      localStorage.removeItem(VIEWER_KEY);
      syncViewerUrl("");
    } else {
      localStorage.setItem(VIEWER_KEY, state.viewerId);
      syncViewerUrl(state.viewerId);
    }
    if (viewerSelect) viewerSelect.value = state.viewerId;
    closeAuthModal();
    showToast("success", `已进入 ${data.viewer?.name || "管理"} 身份。`);
    await loadBootstrap();
  } finally {
    setButtonBusy(authConfirmButton, false);
  }
});

monthInput.addEventListener("change", async () => {
  state.month = monthInput.value;
  localStorage.setItem(MONTH_KEY, state.month);
  await loadBootstrap();
});

refreshButton.addEventListener("click", loadBootstrap);
heroEntryButton?.addEventListener("click", () => {
  document.querySelector(".toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
setupForm.addEventListener("submit", initializeSystem);
objectiveForm.addEventListener("submit", saveObjective);
userForm.addEventListener("submit", saveUser);
resultForm.addEventListener("submit", saveResult);
taskForm.addEventListener("submit", saveTask);
progressForm.addEventListener("submit", saveProgress);
reviewForm.addEventListener("submit", saveReview);
roleRecordForm?.addEventListener("submit", saveRoleRecord);
roleRecordType?.addEventListener("change", renderRoleRecordFields);
generateReportsButton.addEventListener("click", generateReports);
resetSystemButton.addEventListener("click", resetSystem);

loadBootstrap().catch((error) => {
  console.error(error);
  if (!state.data) {
    heroStatus.textContent = "加载失败";
  }
});
