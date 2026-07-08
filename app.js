const API_BASE = `${window.location.origin}/api`;
const VIEWER_KEY = "ai-pilot-viewer";
const MONTH_KEY = "ai-pilot-month";
const queryParams = new URLSearchParams(window.location.search);
const requestedViewerId = queryParams.get("viewer");

const setupPanel = document.getElementById("setupPanel");
const setupForm = document.getElementById("setupForm");
const viewerSelect = document.getElementById("viewerSelect");
const monthInput = document.getElementById("monthInput");
const refreshButton = document.getElementById("refreshButton");
const heroMonth = document.getElementById("heroMonth");
const heroViewer = document.getElementById("heroViewer");
const heroStatus = document.getElementById("heroStatus");
const viewerCard = document.getElementById("viewerCard");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const objectiveForm = document.getElementById("objectiveForm");
const userForm = document.getElementById("userForm");
const resultForm = document.getElementById("resultForm");
const taskForm = document.getElementById("taskForm");
const progressForm = document.getElementById("progressForm");
const reviewForm = document.getElementById("reviewForm");
const generateReportsButton = document.getElementById("generateReportsButton");
const resetSystemButton = document.getElementById("resetSystemButton");

const objectiveOwner = document.getElementById("objectiveOwner");
const resultObjective = document.getElementById("resultObjective");
const resultOwner = document.getElementById("resultOwner");
const taskResult = document.getElementById("taskResult");
const taskOwner = document.getElementById("taskOwner");
const progressTask = document.getElementById("progressTask");
const reviewAnalysis = document.getElementById("reviewAnalysis");
const userList = document.getElementById("userList");
const userFeedback = document.getElementById("userFeedback");

let state = {
  viewerId: requestedViewerId || localStorage.getItem(VIEWER_KEY) || "u_admin_chen",
  month: localStorage.getItem(MONTH_KEY) || new Date().toISOString().slice(0, 7),
  data: null,
  activeTab: "dashboard",
};

monthInput.value = state.month;

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Viewer-Id", state.viewerId);
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

function splitLines(value) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function checkedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function roleLabel(user) {
  if (!user) return "-";
  return user.roles.join(" / ");
}

function objectiveSourceLabel(sourceType) {
  if (sourceType === "self_initiated") return "自行发起";
  if (sourceType === "cross_department") return "其他部门发起";
  return "部门经理安排";
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

function isManagerLike() {
  return viewerHasRole("admin") || viewerHasRole("supervisor");
}

function isEmployeeLike() {
  return viewerHasRole("employee") || viewerHasRole("admin") || viewerHasRole("supervisor");
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

async function loadBootstrap() {
  heroStatus.textContent = "加载中";
  const response = await apiFetch(`/bootstrap?month=${encodeURIComponent(state.month)}&viewer_id=${encodeURIComponent(state.viewerId)}`, {
    method: "GET",
    headers: {},
  });
  if (!response.ok) {
    throw new Error("加载失败");
  }
  state.data = await response.json();
  if (!setupRequired() && state.data.viewer?.id) {
    state.viewerId = state.data.viewer.id;
    localStorage.setItem(VIEWER_KEY, state.viewerId);
    syncViewerUrl(state.viewerId);
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
    option.textContent = `${user.name}｜${user.position}｜${user.roles.join(", ")}`;
    viewerSelect.appendChild(option);
  }
  viewerSelect.value = current;
}

function renderHeader() {
  const viewer = getViewer();
  heroMonth.textContent = state.month;
  heroViewer.textContent = viewer ? `${viewer.name}｜${viewer.position}` : "待初始化";
  viewerCard.innerHTML = viewer
    ? `当前正在以 <strong>${escapeHtml(viewer.name)}</strong> 的身份验证系统。角色为 <strong>${escapeHtml(roleLabel(viewer))}</strong>，可重点检查你当前角色应该看到和能操作的链路。`
    : "当前还没有任何身份，系统处于真实初始化模式。";
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
  const stats = state.data.dashboard.metrics;
  const statCards = [
    ["目标数", stats.objectiveCount, "当前推进中的试点目标数量", Math.min(100, stats.objectiveCount * 18), "blue"],
    ["成果数", stats.resultCount, "目标下正在跟进的成果数量", Math.min(100, stats.resultCount * 20), "orange"],
    ["事项数", stats.taskCount, "本月有活动的事项总数", Math.min(100, stats.taskCount * 12), "yellow"],
    ["事项完成率", formatPercent(stats.completionRate), "已完成/上线事项 ÷ 本月计划事项", clampPercent(stats.completionRate), "blue"],
    ["上线交付率", formatPercent(stats.launchRate), "上线/交付事项 ÷ 已完成事项", clampPercent(stats.launchRate), "orange"],
    ["跨月事项", stats.crossMonthCount, "跨月继续推进的事项数量", Math.min(100, stats.crossMonthCount * 28), "yellow"],
    ["受阻事项", stats.blockedCount, "等待协同或暂停状态的事项", Math.min(100, stats.blockedCount * 35), "orange"],
    ["高价值事项", stats.highValueCount, "AI 识别为 V4/V5 的事项数量", Math.min(100, stats.highValueCount * 40), "blue"],
    ["风险事项", stats.riskTaskCount, "中高风险事项数量", Math.min(100, stats.riskTaskCount * 36), "yellow"],
  ];

  document.getElementById("dashboardStats").innerHTML = statCards.map(([label, value, detail, visualPercent, tone]) => `
    <article class="stat-card tone-${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
      <div class="stat-meter"><i style="width:${clampPercent(visualPercent)}%"></i></div>
      <small>${detail}</small>
    </article>
  `).join("");

  const pulseNode = document.getElementById("dashboardPulse");
  if (pulseNode) {
    pulseNode.innerHTML = `
      <div class="pulse-story">
        <div class="pulse-illustration">
          <div class="pulse-orb orb-blue"></div>
          <div class="pulse-orb orb-orange"></div>
          <div class="pulse-orb orb-yellow"></div>
          <div class="pulse-line"></div>
        </div>
        <div class="pulse-copy">
          <h4>本月执行闭环</h4>
          <p>用最少步骤看到目标推进、事项节奏、交付转化和风险暴露。</p>
        </div>
      </div>
      <div class="pulse-kpis">
        <div class="pulse-kpi tone-blue">
          <span>完成</span>
          <strong>${formatPercent(stats.completionRate)}</strong>
        </div>
        <div class="pulse-kpi tone-orange">
          <span>交付</span>
          <strong>${formatPercent(stats.launchRate)}</strong>
        </div>
        <div class="pulse-kpi tone-yellow">
          <span>风险</span>
          <strong>${stats.riskTaskCount}</strong>
        </div>
      </div>
    `;
  }

  const statusChartNode = document.getElementById("dashboardStatusChart");
  if (statusChartNode) {
    const statusMap = new Map();
    for (const task of state.data.tasks) {
      const key = task.currentStatus || "unknown";
      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }
    const items = Array.from(statusMap.entries());
    const maxCount = Math.max(...items.map(([, count]) => count), 1);
    const palette = ["blue", "orange", "yellow", "ink", "blue"];
    statusChartNode.innerHTML = items.length
      ? items.map(([status, count], index) => `
        <div class="status-row tone-${palette[index % palette.length]}">
          <div class="status-meta">
            <span>${escapeHtml(status)}</span>
            <strong>${count}</strong>
          </div>
          <div class="status-bar"><i style="width:${(count / maxCount) * 100}%"></i></div>
        </div>
      `).join("")
      : '<p class="empty-hint">当前还没有事项状态数据</p>';
  }

  document.getElementById("objectiveBoardBody").innerHTML = state.data.dashboard.objectiveBoard.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${formatPercent(item.progressRatio * 100)}</td>
    </tr>
  `).join("") || '<tr><td colspan="3">暂无目标</td></tr>';

  document.getElementById("resultBoardBody").innerHTML = state.data.dashboard.resultBoard.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.stage)}</td>
      <td>${item.taskCount}</td>
      <td>${item.riskCount}</td>
    </tr>
  `).join("") || '<tr><td colspan="4">暂无成果</td></tr>';

  document.getElementById("peopleBoardBody").innerHTML = state.data.dashboard.peopleBoard.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${item.taskCount}</td>
      <td>${formatPercent(item.completionRate)}</td>
      <td>${escapeHtml(item.abilityTags.join("、") || "待积累")}</td>
      <td>${escapeHtml(item.riskLevel)}</td>
    </tr>
  `).join("") || '<tr><td colspan="5">暂无人员数据</td></tr>';

  document.getElementById("riskBoardList").innerHTML = state.data.dashboard.riskBoard.map((item) => `
    <li><span>${escapeHtml(item.riskType)}</span><strong>${item.count}</strong></li>
  `).join("") || '<li><span>暂无风险</span><strong>0</strong></li>';

  document.getElementById("valueBoardList").innerHTML = state.data.dashboard.valueBoard.map((item) => `
    <li><span>${escapeHtml(item.valueLevel)}</span><strong>${item.count}</strong></li>
  `).join("") || '<li><span>暂无价值数据</span><strong>0</strong></li>';
}

renderDashboard = function renderDashboardOverride() {
  const stats = state.data.dashboard.metrics;

  const summaryCards = [
    ["完成率", formatPercent(stats.completionRate), "blue"],
    ["交付率", formatPercent(stats.launchRate), "orange"],
    ["风险事项", stats.riskTaskCount, "yellow"],
  ];

  document.getElementById("dashboardStats").innerHTML = summaryCards.map(([label, value, tone]) => `
    <article class="summary-stat tone-${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  const badgeNode = document.getElementById("dashboardBadges");
  if (badgeNode) {
    badgeNode.innerHTML = `
      <span class="focus-badge tone-blue">目标 ${stats.objectiveCount}</span>
      <span class="focus-badge tone-orange">成果 ${stats.resultCount}</span>
      <span class="focus-badge tone-yellow">事项 ${stats.taskCount}</span>
    `;
  }

  const focusNode = document.getElementById("dashboardFocusStory");
  if (focusNode) {
    focusNode.innerHTML = `
      <div class="summary-hero">
        <div class="summary-ring">
          <div class="summary-ring-core">
            <span>本月总览</span>
            <strong>${formatPercent((Number(stats.completionRate || 0) + Number(stats.launchRate || 0)) / 2)}</strong>
          </div>
        </div>
        <div class="summary-bars">
          <div class="summary-bar-row">
            <label>目标推进</label>
            <div class="summary-bar"><i style="width:${Math.max(12, clampPercent(stats.objectiveCount * 18))}%"></i></div>
            <strong>${stats.objectiveCount}</strong>
          </div>
          <div class="summary-bar-row">
            <label>成果承接</label>
            <div class="summary-bar"><i style="width:${Math.max(12, clampPercent(stats.resultCount * 20))}%"></i></div>
            <strong>${stats.resultCount}</strong>
          </div>
          <div class="summary-bar-row">
            <label>事项活跃</label>
            <div class="summary-bar"><i style="width:${Math.max(12, clampPercent(stats.taskCount * 12))}%"></i></div>
            <strong>${stats.taskCount}</strong>
          </div>
          <div class="summary-bar-row">
            <label>跨月延续</label>
            <div class="summary-bar"><i style="width:${Math.max(10, clampPercent(stats.crossMonthCount * 28))}%"></i></div>
            <strong>${stats.crossMonthCount}</strong>
          </div>
        </div>
      </div>
    `;
  }

  const legacyVisual = document.querySelector(".dashboard-visual-grid");
  if (legacyVisual) {
    const legacyPulse = legacyVisual.querySelector(".contrast-panel");
    if (legacyPulse) legacyPulse.hidden = true;
    legacyVisual.classList.add("dashboard-visual-grid-compact");
  }

  const statusChartNode = document.getElementById("dashboardStatusChart");
  if (statusChartNode) {
    const statusMap = new Map();
    for (const task of state.data.tasks) {
      const key = task.currentStatus || "unknown";
      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }
    const items = Array.from(statusMap.entries());
    const maxCount = Math.max(...items.map(([, count]) => count), 1);
    const palette = ["blue", "orange", "yellow", "ink", "blue"];
    statusChartNode.innerHTML = items.length
      ? items.map(([status, count], index) => `
        <div class="status-row tone-${palette[index % palette.length]}">
          <div class="status-meta">
            <span>${escapeHtml(status)}</span>
            <strong>${count}</strong>
          </div>
          <div class="status-bar"><i style="width:${(count / maxCount) * 100}%"></i></div>
        </div>
      `).join("")
      : '<p class="empty-hint">当前还没有事项状态数据</p>';
  }

  document.getElementById("objectiveBoardBody").innerHTML = state.data.dashboard.objectiveBoard.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${formatPercent(item.progressRatio * 100)}</td>
    </tr>
  `).join("") || '<tr><td colspan="3">暂无目标</td></tr>';

  document.getElementById("resultBoardBody").innerHTML = state.data.dashboard.resultBoard.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.stage)}</td>
      <td>${item.taskCount}</td>
      <td>${item.riskCount}</td>
    </tr>
  `).join("") || '<tr><td colspan="4">暂无成果</td></tr>';

  document.getElementById("peopleBoardBody").innerHTML = state.data.dashboard.peopleBoard.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${item.taskCount}</td>
      <td>${formatPercent(item.completionRate)}</td>
      <td>${escapeHtml(item.abilityTags.join("、") || "待积累")}</td>
      <td>${escapeHtml(item.riskLevel)}</td>
    </tr>
  `).join("") || '<tr><td colspan="5">暂无人员数据</td></tr>';

  document.getElementById("riskBoardList").innerHTML = state.data.dashboard.riskBoard.map((item) => `
    <li><span>${escapeHtml(item.riskType)}</span><strong>${item.count}</strong></li>
  `).join("") || '<li><span>暂无风险</span><strong>0</strong></li>';

  document.getElementById("valueBoardList").innerHTML = state.data.dashboard.valueBoard.map((item) => `
    <li><span>${escapeHtml(item.valueLevel)}</span><strong>${item.count}</strong></li>
  `).join("") || '<li><span>暂无价值数据</span><strong>0</strong></li>';
};

function renderUsers() {
  userList.innerHTML = state.data.users
    .filter((item) => !item.roles.includes("ai_system"))
    .map((item) => `
      <article class="list-card">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(item.roles.join(", "))}</span>
              <span class="tag">${escapeHtml(item.position || "-")}</span>
            </div>
          </div>
        </header>
        <p>${escapeHtml(item.department)}</p>
      </article>
    `)
    .join("") || '<p class="empty-hint">暂无测试身份</p>';
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
              <span class="status-pill">${escapeHtml(item.stage)}</span>
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
      <article class="task-card">
        <header>
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <div class="meta-line">
              <span class="status-pill">${escapeHtml(task.currentStatus)}</span>
              <span class="tag">成果：${escapeHtml(result?.name || "")}</span>
              <span class="tag">负责人：${escapeHtml(owner?.name || task.ownerId)}</span>
            </div>
          </div>
          <small class="muted">累计 ${task.totalInputHours}h / ${task.progressCount} 次</small>
        </header>
        <p>${escapeHtml(task.content)}</p>
        <div class="tag-row">
          <span class="tag">计划完成：${escapeHtml(task.plannedCompleteDate || "未填")}</span>
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
            ${review ? `<p class="muted">主管状态：${escapeHtml(review.reviewStatus)}${review.comment ? `｜${escapeHtml(review.comment)}` : ""}</p>` : ""}
          </div>
        ` : ""}
        ${progressItems.length ? `
          <div class="report-section">
            <strong>最新进展</strong>
            <ul>
              ${progressItems.slice(0, 3).map((item) => `<li>${escapeHtml(item.createdAt.slice(0, 10))}｜${escapeHtml(item.progressContent)}｜${item.inputHours}h</li>`).join("")}
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
                <span class="status-pill">${escapeHtml(item.reportStatus)}</span>
                <span class="tag">${escapeHtml(item.reportMonth)}</span>
              </div>
            </div>
          </header>
          <p>${escapeHtml(item.aiGeneratedContent.narrative || "无摘要")}</p>
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
  const detail = document.getElementById("reportDetail");
  detail.innerHTML = `
    <h3>${escapeHtml(user?.name || report.userId)}｜${escapeHtml(report.reportMonth)} 月报</h3>
    <p class="muted">${escapeHtml(content.narrative || "")}</p>
    <section class="report-section">
      <strong>本月核心工作</strong>
      <ul>${(content.core_work || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>目标推进情况</strong>
      <ul>${(content.objective_progress || []).map((item) => `<li>${escapeHtml(item.name)}｜${formatPercent((item.progressRatio || 0) * 100)}｜${escapeHtml(item.status)}</li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="report-section">
      <strong>成果完成情况</strong>
      <ul>${(content.result_progress || []).map((item) => `<li>${escapeHtml(item.name)}｜${escapeHtml(item.stage)}｜完成 ${item.completedTasks}/${item.taskCount}</li>`).join("") || "<li>暂无</li>"}</ul>
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
        <li>能力变化：${escapeHtml((content.ability_growth || []).join("、") || "暂无")}</li>
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
  if (!response.ok) return alert((await response.json()).error || "保存失败");
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
    showFeedback(userFeedback, "error", data.error || "新增失败，请稍后重试。");
    return;
  }
  userForm.reset();
  userForm.querySelector('input[name="roles"][value="employee"]').checked = true;
  userForm.elements.department.value = "AI部";
  state.activeTab = "users";
  await loadBootstrap();
  showFeedback(userFeedback, "success", `已成功新增成员：${payload.name}。现在可以切换身份继续真实填写。`);
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
  if (!response.ok) return alert(data.error || "初始化失败");
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
  if (!response.ok) return alert((await response.json()).error || "保存失败");
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
  if (!response.ok) return alert((await response.json()).error || "保存失败");
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
  if (!response.ok) return alert((await response.json()).error || "保存失败");
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
  if (!response.ok) return alert((await response.json()).error || "保存失败");
  reviewForm.reset();
  await loadBootstrap();
}

async function generateReports() {
  const response = await apiFetch("/reports/generate", {
    method: "POST",
    body: JSON.stringify({ reportMonth: state.month }),
  });
  if (!response.ok) return alert((await response.json()).error || "生成失败");
  await loadBootstrap();
}

async function resetSystem() {
  const confirmed = window.confirm("这会清空当前所有目标、成果、事项、月报和原始测试身份，只保留一个管理员底座。确定继续吗？");
  if (!confirmed) return;
  const response = await apiFetch("/system/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) return alert((await response.json()).error || "清空失败");
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

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

viewerSelect.addEventListener("change", async () => {
  state.viewerId = viewerSelect.value;
  localStorage.setItem(VIEWER_KEY, state.viewerId);
  syncViewerUrl(state.viewerId);
  await loadBootstrap();
});

monthInput.addEventListener("change", async () => {
  state.month = monthInput.value;
  localStorage.setItem(MONTH_KEY, state.month);
  await loadBootstrap();
});

refreshButton.addEventListener("click", loadBootstrap);
setupForm.addEventListener("submit", initializeSystem);
objectiveForm.addEventListener("submit", saveObjective);
userForm.addEventListener("submit", saveUser);
resultForm.addEventListener("submit", saveResult);
taskForm.addEventListener("submit", saveTask);
progressForm.addEventListener("submit", saveProgress);
reviewForm.addEventListener("submit", saveReview);
generateReportsButton.addEventListener("click", generateReports);
resetSystemButton.addEventListener("click", resetSystem);

loadBootstrap().catch((error) => {
  console.error(error);
  heroStatus.textContent = "加载失败";
});
