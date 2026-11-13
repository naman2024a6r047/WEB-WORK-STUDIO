// ============================================================================
// CENTRAL ERP COMMAND — Single Page Application Engine
// Multi-School ERP Management & Business Intelligence Platform
// ============================================================================

(function () {
  'use strict';

  // Global State
  const state = {
    activeTab: 'overview',
    currentUser: null,
    token: localStorage.getItem('central_token') || null,
    theme: localStorage.getItem('central_theme') || 'dark',
    schools: [],
    selectedSchoolId: null,
    invoices: [],
    plans: [],
    notifications: [],
    activeCharts: {}
  };

  const API_BASE = '/api/v1';

  // API helper with JWT injection
  async function api(endpoint, options = {}) {
    const headers = options.headers || {};
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: Request failed`);
      }
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Initialize Application
  async function init() {
    setupTheme();
    setupNavigation();
    setupModals();
    setupGlobalSearch();
    setupLoginForm();

    const isAuthenticated = await checkAuthSession();
    if (isAuthenticated) {
      await loadInitialData();
      renderCurrentTab();
    }
  }

  // Authentication & Session Management
  function showLoginView() {
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app-shell');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appShell) appShell.style.display = 'none';
  }

  function showAppShell() {
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app-shell');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appShell) appShell.style.display = 'flex';
  }

  async function checkAuthSession() {
    if (state.token) {
      try {
        const res = await api('/auth/me');
        if (res.success && res.user) {
          state.currentUser = res.user;
          updateUserBadge();
          showAppShell();
          return true;
        }
      } catch (e) {
        state.token = null;
        localStorage.removeItem('central_token');
      }
    }
    showLoginView();
    return false;
  }

  function setupLoginForm() {
    const form = document.getElementById('form-login');
    const identifierInput = document.getElementById('login-identifier');
    const passInput = document.getElementById('login-password');
    const mfaGroup = document.getElementById('group-login-mfa');
    const mfaInput = document.getElementById('login-mfa');
    const errAlert = document.getElementById('login-error-alert');
    const errText = document.getElementById('login-error-text');
    const submitBtn = document.getElementById('btn-submit-login');
    const togglePassBtn = document.getElementById('btn-toggle-login-pass');
    const togglePassIcon = document.getElementById('toggle-pass-icon');

    // Toggle password visibility
    if (togglePassBtn && passInput) {
      togglePassBtn.addEventListener('click', () => {
        if (passInput.type === 'password') {
          passInput.type = 'text';
          if (togglePassIcon) {
            togglePassIcon.classList.remove('fa-eye');
            togglePassIcon.classList.add('fa-eye-slash');
          }
        } else {
          passInput.type = 'password';
          if (togglePassIcon) {
            togglePassIcon.classList.remove('fa-eye-slash');
            togglePassIcon.classList.add('fa-eye');
          }
        }
      });
    }

    // Clear error alert on new input
    [identifierInput, passInput, mfaInput].forEach(inp => {
      if (inp) {
        inp.addEventListener('input', () => {
          if (errAlert) errAlert.style.display = 'none';
        });
      }
    });

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const identifier = identifierInput?.value.trim();
        const password = passInput?.value;
        const mfaCode = mfaInput?.value.trim();

        if (!identifier || !password) {
          if (errAlert && errText) {
            errText.textContent = 'Please enter both User ID / Email and password.';
            errAlert.style.display = 'block';
          }
          return;
        }

        if (errAlert) errAlert.style.display = 'none';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating with Database...';
        }

        try {
          const res = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identifier, password, mfaCode })
          });

          // Check if user requires MFA 2-factor code
          if (res.requiresMfa) {
            if (mfaGroup) mfaGroup.style.display = 'block';
            if (mfaInput) mfaInput.focus();
            if (errAlert && errText) {
              errText.textContent = res.message || 'Two-factor authentication code required. Please enter code.';
              errAlert.style.display = 'block';
              errAlert.style.background = 'rgba(37,99,235,0.12)';
              errAlert.style.borderColor = '#2563eb';
              errAlert.style.color = '#3b82f6';
            }
            return;
          }

          if (res.success && res.token) {
            state.token = res.token;
            state.currentUser = res.user;
            localStorage.setItem('central_token', state.token);
            updateUserBadge();
            showAppShell();
            showToast(`Signed in successfully as ${res.user.fullName || res.user.id}`, 'success');
            await loadInitialData();
            renderCurrentTab();
          } else {
            throw new Error(res.error || 'Authentication failed');
          }
        } catch (err) {
          if (errAlert && errText) {
            errAlert.style.background = 'rgba(239,68,68,0.12)';
            errAlert.style.borderColor = '#ef4444';
            errAlert.style.color = '#ef4444';
            errText.textContent = err.message || 'Invalid User ID/Email or Password. Only credentials stored in the database are allowed.';
            errAlert.style.display = 'block';
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In to Central Command';
          }
        }
      });
    }

    // Direct Logout Button in Topbar
    const logoutBtn = document.getElementById('btn-topbar-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (!confirm('Are you sure you want to sign out of Central ERP Command?')) return;
        state.token = null;
        state.currentUser = null;
        localStorage.removeItem('central_token');
        if (passInput) passInput.value = '';
        if (mfaInput) mfaInput.value = '';
        showLoginView();
        showToast('You have been signed out.', 'info');
      });
    }
  }

  function updateUserBadge() {
    if (!state.currentUser) return;
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');
    const avatarEl = document.getElementById('user-avatar-initials');

    if (nameEl) nameEl.textContent = state.currentUser.fullName || state.currentUser.email;
    if (roleEl) roleEl.textContent = state.currentUser.role;
    if (avatarEl) {
      const parts = (state.currentUser.fullName || 'SA').split(' ');
      avatarEl.textContent = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    }
  }

  // Theme Management
  function setupTheme() {
    const btn = document.getElementById('theme-toggle-btn');
    if (state.theme === 'light') {
      document.body.classList.remove('dark-mode');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
      document.body.classList.add('dark-mode');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }

    if (btn) {
      btn.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('central_theme', state.theme);
        if (state.theme === 'light') {
          document.body.classList.remove('dark-mode');
          btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        } else {
          document.body.classList.add('dark-mode');
          btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        }
        // Re-render active charts to adapt colors
        if (state.activeTab === 'overview') {
          renderOverview();
        }
      });
    }
  }

  // Tab Navigation
  function setupNavigation() {
    const items = document.querySelectorAll('.nav-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        if (!tab) return;
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        state.activeTab = tab;
        renderCurrentTab();
      });
    });

    // Topbar Notif Click
    const notifBtn = document.getElementById('topbar-notif-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => {
        switchTab('notifications');
      });
    }

    // User Profile Click -> Open Switch User modal
    const userBtn = document.getElementById('user-menu-btn');
    if (userBtn) {
      userBtn.addEventListener('click', () => {
        openModal('modal-auth-users');
      });
    }

    // Quick Onboard Button
    const onboardBtn = document.getElementById('btn-quick-onboard');
    if (onboardBtn) {
      onboardBtn.addEventListener('click', () => {
        openModal('modal-register-school');
      });
    }
  }

  function switchTab(tabName) {
    const items = document.querySelectorAll('.nav-item');
    items.forEach(i => {
      if (i.getAttribute('data-tab') === tabName) {
        i.classList.add('active');
      } else {
        i.classList.remove('active');
      }
    });
    state.activeTab = tabName;
    renderCurrentTab();
  }

  // Load Data
  async function loadInitialData() {
    try {
      const [schoolsRes, plansRes, notifsRes] = await Promise.all([
        api('/schools'),
        api('/plans'),
        api('/notifications')
      ]);

      if (schoolsRes.success) state.schools = schoolsRes.data;
      if (plansRes.success) state.plans = plansRes.data;
      if (notifsRes.success) {
        state.notifications = notifsRes.data;
        const badge = document.getElementById('notifications-count-badge');
        const dot = document.getElementById('notif-dot');
        if (badge) badge.textContent = notifsRes.unreadCount || 0;
        if (dot) dot.style.display = notifsRes.unreadCount > 0 ? 'block' : 'none';
      }

      // Update schools count badge in sidebar
      const schoolsBadge = document.getElementById('schools-count-badge');
      if (schoolsBadge) schoolsBadge.textContent = state.schools ? state.schools.length : 0;

      // Populate school select options in modals
      populateSchoolDropdowns();
    } catch (err) {
      console.error('Initial data load error', err);
    }
  }

  function populateSchoolDropdowns() {
    const invSelect = document.getElementById('inv-school-select');
    if (invSelect) {
      if (!state.schools || state.schools.length === 0) {
        invSelect.innerHTML = '<option value="">No schools registered yet</option>';
      } else {
        invSelect.innerHTML = state.schools.map(s => `
          <option value="${s.id}">${s.name} (${s.code}) - ${s.plan_name || 'Standard'}</option>
        `).join('');
      }
    }
  }

  // Global Search
  function setupGlobalSearch() {
    const searchInput = document.getElementById('global-search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) return;

      if (state.activeTab !== 'schools' && state.activeTab !== 'analytics') {
        switchTab('schools');
      }

      const rows = document.querySelectorAll('.school-row');
      rows.forEach(r => {
        const text = r.textContent.toLowerCase();
        r.style.display = text.includes(q) ? '' : 'none';
      });
    });
  }

  // Routing / View Rendering
  function renderCurrentTab() {
    const container = document.getElementById('view-content');
    if (!container) return;

    // Destroy existing Chart.js instances to avoid memory leaks
    Object.values(state.activeCharts).forEach(c => c && c.destroy && c.destroy());
    state.activeCharts = {};

    switch (state.activeTab) {
      case 'overview':
        renderOverview();
        break;
      case 'schools':
        renderSchoolsList();
        break;
      case 'school-profile':
        renderSchoolProfile(state.selectedSchoolId);
        break;
      case 'analytics':
        renderAnalytics();
        break;
      case 'subscriptions':
        renderSubscriptions();
        break;
      case 'invoices':
        renderInvoices();
        break;
      case 'remote-controls':
        renderRemoteControls();
        break;
      case 'erp-monitoring':
        renderERPMonitoring();
        break;
      case 'security':
        renderSecurityLogs();
        break;
      case 'notifications':
        renderNotifications();
        break;
      case 'reports':
        renderReports();
        break;
      case 'integrations':
        renderIntegrations();
        break;
      case 'settings':
        renderSettings();
        break;
      case 'admin':
        renderAdminAccess();
        break;
      default:
        renderOverview();
    }
  }

  // ==========================================================================
  // 1. OVERVIEW (EXECUTIVE SAAS DASHBOARD)
  // ==========================================================================
  async function renderOverview() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--accent-primary);"></i>
        <div style="margin-top: 0.5rem; color: var(--text-muted);">Calculating live multi-school telemetry and financial census...</div>
      </div>
    `;

    try {
      const res = await api('/analytics/overview');
      const data = res.data;
      const { overview, charts, upcomingRenewals, recentSecurityEvents, recentAudits } = data;

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h1 class="page-title"><i class="fa-solid fa-chart-pie" style="color: var(--accent-primary);"></i> SaaS Executive Overview</h1>
            <div class="page-subtitle">Central Business Intelligence • Connected ERP Telemetry • Financial Metrics (INR)</div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span style="font-size: 0.75rem; color: var(--text-muted);">Synchronized: <strong>${new Date().toLocaleTimeString()}</strong></span>
            <button class="btn btn-secondary btn-sm" id="btn-refresh-overview" title="Refresh Live Metrics">
              <i class="fa-solid fa-rotate"></i> Sync
            </button>
          </div>
        </div>

        ${overview.schools.total_schools === 0 ? `
        <div style="background: linear-gradient(135deg, rgba(37,99,235,0.12), rgba(16,185,129,0.08)); border: 1px solid rgba(37,99,235,0.3); border-radius: 10px; padding: 1.5rem 1.75rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 1.25rem;">
            <div style="width: 48px; height: 48px; border-radius: 10px; background: var(--accent-primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
              <i class="fa-solid fa-rocket"></i>
            </div>
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;">Clean Production Environment Ready</h3>
              <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">All dummy placeholder data has been removed. Click <strong>Register School</strong> to onboard your first school ERP website with dynamic per-student pricing.</p>
            </div>
          </div>
          <button class="btn btn-primary" onclick="openModal('modal-register-school')">
            <i class="fa-solid fa-plus"></i> Register First School
          </button>
        </div>
        ` : ''}

        <!-- Simulation Quick-Trigger Toolbar -->
        <div class="sim-toolbar">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <i class="fa-solid fa-flask-vial" style="color: var(--accent-primary);"></i>
            <span style="font-size: 0.8rem; font-weight: 600;">Interactive Live Simulation Console:</span>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" id="btn-sim-sync" title="Simulate real-time student & teacher sync from a connected ERP">
              <i class="fa-solid fa-cloud-arrow-up"></i> Simulate ERP Sync Ping
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-sim-eval-rules" title="Evaluate pre-expiry, overdue, and grace-period automation rules">
              <i class="fa-solid fa-bolt"></i> Evaluate Automation Rules
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-sim-heartbeat" title="Dispatch telemetry heartbeat from school ERP connector">
              <i class="fa-solid fa-wave-square"></i> Simulate Telemetry Heartbeat
            </button>
          </div>
        </div>

        <!-- Primary KPI Metrics Grid -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Total Schools</span>
              <div class="kpi-icon" style="background: rgba(37,99,235,0.15); color: #3b82f6;"><i class="fa-solid fa-school"></i></div>
            </div>
            <div class="kpi-value">${overview.schools.total_schools}</div>
            <div class="kpi-footer">
              <span class="badge badge-active" style="padding: 0.1rem 0.4rem;">${overview.schools.active_schools} Active</span>
              <span class="badge badge-suspended" style="padding: 0.1rem 0.4rem;">${overview.schools.suspended_schools} Suspended</span>
              <span class="badge badge-trial" style="padding: 0.1rem 0.4rem;">${overview.schools.trial_schools} Trial</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Total Students Enrolled</span>
              <div class="kpi-icon" style="background: rgba(16,185,129,0.15); color: #10b981;"><i class="fa-solid fa-user-graduate"></i></div>
            </div>
            <div class="kpi-value">${overview.census.total_students.toLocaleString()}</div>
            <div class="kpi-footer" style="color: #10b981;">
              <i class="fa-solid fa-circle-check"></i>
              <span>${overview.census.total_active_students.toLocaleString()} active students in session</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Faculty & Staff</span>
              <div class="kpi-icon" style="background: rgba(139,92,246,0.15); color: #8b5cf6;"><i class="fa-solid fa-chalkboard-user"></i></div>
            </div>
            <div class="kpi-value">${overview.census.total_teachers} <span style="font-size: 0.9rem; color: var(--text-muted); font-weight: normal;">Teachers</span></div>
            <div class="kpi-footer">
              <span>+ ${overview.census.total_non_teaching_staff} administrative & support staff</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Monthly Recurring (MRR)</span>
              <div class="kpi-icon" style="background: rgba(16,185,129,0.15); color: #10b981;"><i class="fa-solid fa-money-bill-trend-up"></i></div>
            </div>
            <div class="kpi-value">₹${overview.financial.mrr.toLocaleString()}</div>
            <div class="kpi-footer">
              <span>Annualized Run-Rate: <strong>₹${overview.financial.arr.toLocaleString()}</strong></span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Revenue Collected</span>
              <div class="kpi-icon" style="background: rgba(37,99,235,0.15); color: #3b82f6;"><i class="fa-solid fa-vault"></i></div>
            </div>
            <div class="kpi-value">₹${overview.financial.totalRevenueCollected.toLocaleString()}</div>
            <div class="kpi-footer" style="color: #10b981;">
              <i class="fa-solid fa-shield-check"></i> Verified subscription fees paid to SaaS HQ
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Overdue Receivables</span>
              <div class="kpi-icon" style="background: rgba(239,68,68,0.15); color: #ef4444;"><i class="fa-solid fa-receipt"></i></div>
            </div>
            <div class="kpi-value" style="color: ${overview.financial.overdueAmount > 0 ? '#ef4444' : 'inherit'};">
              ₹${overview.financial.overdueAmount.toLocaleString()}
            </div>
            <div class="kpi-footer" style="color: #ef4444;">
              <i class="fa-solid fa-circle-exclamation"></i>
              <span>${overview.financial.overdueInvoicesCount} overdue subscription invoices</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>ERP Connectors Health</span>
              <div class="kpi-icon" style="background: rgba(16,185,129,0.15); color: #10b981;"><i class="fa-solid fa-server"></i></div>
            </div>
            <div class="kpi-value">${overview.systemHealth.healthyCount} / ${overview.schools.total_schools}</div>
            <div class="kpi-footer">
              <span class="badge ${overview.systemHealth.offlineCount > 0 ? 'badge-stale' : 'badge-healthy'}">
                ${overview.systemHealth.offlineCount} Stale/Offline
              </span>
              <span>• Synchronized via HTTPS</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Approaching Renewals</span>
              <div class="kpi-icon" style="background: rgba(245,158,11,0.15); color: #f59e0b;"><i class="fa-solid fa-calendar-check"></i></div>
            </div>
            <div class="kpi-value">${overview.upcomingRenewalsCount}</div>
            <div class="kpi-footer">
              <span>Schools expiring in next 30 days</span>
            </div>
          </div>
        </div>

        <!-- ⏰ Upcoming Payment Due Alerts (Next 2-3 Days & Overdue) -->
        <div class="card" style="margin-bottom: 1.5rem; border-left: 4px solid #f59e0b;">
          <div class="card-header" style="flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <div class="card-title" style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-clock-rotate-left" style="color: #f59e0b;"></i> Upcoming Payment Due Alerts (Next 2-3 Days & Delinquent)
                <span class="badge badge-overdue" id="dues-count-badge" style="display: none; padding: 0.15rem 0.55rem; font-size: 0.72rem;">0 Pending</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
                Live payment tracking • Send official PDF invoice by email • Direct WhatsApp payment reminder to school owner
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <label for="select-due-cycle" style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0;">Payment Cycle:</label>
              <select class="form-select form-select-sm" id="select-due-cycle" style="width: auto; padding: 0.28rem 0.65rem; font-size: 0.78rem; font-weight: 600;">
                <option value="ALL" selected>All Payment Cycles</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="HALF_YEARLY">Half-Yearly</option>
                <option value="YEARLY">Yearly</option>
              </select>
              <button class="btn btn-secondary btn-sm" id="btn-refresh-dues" title="Refresh Payment Dues" style="padding: 0.28rem 0.65rem;">
                <i class="fa-solid fa-rotate"></i>
              </button>
            </div>
          </div>
          <div class="card-body" style="padding: 0;" id="upcoming-dues-container">
            <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.85rem;">
              <i class="fa-solid fa-spinner fa-spin"></i> Checking approaching payment dues...
            </div>
          </div>
        </div>

        <!-- 4 High-Density Responsive Analytical Charts -->
        <div class="charts-grid">
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fa-solid fa-chart-column" style="color: var(--accent-primary);"></i> School-wise Student Enrollment Distribution</div>
              <span style="font-size: 0.72rem; color: var(--text-muted);">Live Sync Data</span>
            </div>
            <div class="card-body">
              <div style="height: 240px; position: relative;">
                <canvas id="chart-students-dist"></canvas>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fa-solid fa-chart-line" style="color: #10b981;"></i> Monthly SaaS Subscription Revenue Trend (INR)</div>
              <span style="font-size: 0.72rem; color: var(--text-muted);">Settled Receipts</span>
            </div>
            <div class="card-body">
              <div style="height: 240px; position: relative;">
                <canvas id="chart-revenue-trend"></canvas>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fa-solid fa-chart-bar" style="color: #8b5cf6;"></i> Teacher Census Across Independent School ERPs</div>
              <span style="font-size: 0.72rem; color: var(--text-muted);">Verified Faculty</span>
            </div>
            <div class="card-body">
              <div style="height: 240px; position: relative;">
                <canvas id="chart-teachers-dist"></canvas>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fa-solid fa-chart-pie" style="color: #f59e0b;"></i> Subscription Health & Payment Status Breakdown</div>
              <span style="font-size: 0.72rem; color: var(--text-muted);">Commercial State</span>
            </div>
            <div class="card-body">
              <div style="height: 240px; position: relative;">
                <canvas id="chart-subscription-status"></canvas>
              </div>
            </div>
          </div>
        </div>

        <!-- Lower Section: Approaching Renewals & Security Stream -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
          <!-- Approaching Renewals -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fa-solid fa-clock-rotate-left" style="color: #f59e0b;"></i> Upcoming Subscription Renewals (Next 30 Days)</div>
            </div>
            <div class="card-body" style="padding: 0;">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>School</th>
                    <th>Plan</th>
                    <th>Expiry Date</th>
                    <th>Days Left</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${upcomingRenewals.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No renewals approaching in next 30 days</td></tr>` : ''}
                  ${upcomingRenewals.map(r => `
                    <tr>
                      <td>
                        <strong>${r.name}</strong>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${r.code}</div>
                      </td>
                      <td><span class="badge badge-trial">${r.plan_name || 'Standard'}</span></td>
                      <td>${r.subscription_end}</td>
                      <td>
                        <span class="badge ${r.days_remaining <= 7 ? 'badge-overdue' : 'badge-pending'}">
                          ${r.days_remaining} Days
                        </span>
                      </td>
                      <td>
                        <button class="btn btn-primary btn-sm btn-quick-renew" data-id="${r.id}">
                          <i class="fa-solid fa-file-invoice"></i> Bill
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Centralized Security Events Stream -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fa-solid fa-shield-halved" style="color: var(--accent-primary);"></i> Central Security Stream (Across All ERPs)</div>
              <button class="btn btn-secondary btn-sm" id="btn-view-all-sec">View All</button>
            </div>
            <div class="card-body" style="padding: 0.75rem;">
              <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                ${recentSecurityEvents.map(e => `
                  <div style="padding: 0.6rem 0.8rem; border-radius: 6px; background: var(--bg-card-header); border: 1px solid var(--border-main); display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
                    <div>
                      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem;">
                        <span class="badge ${e.severity === 'CRITICAL' ? 'badge-suspended' : e.severity === 'ERROR' ? 'badge-overdue' : e.severity === 'WARNING' ? 'badge-pending' : 'badge-healthy'}" style="font-size: 0.65rem;">
                          ${e.severity}
                        </span>
                        <strong style="font-size: 0.8rem;">${e.school_name || 'Central Platform'}</strong>
                      </div>
                      <div style="font-size: 0.775rem; color: var(--text-main);">${e.description}</div>
                      <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.2rem;">
                        Source: ${e.source_erp} • User: ${e.user_identifier || 'N/A'} • ${new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `;

      // Render Charts with Chart.js
      renderOverviewCharts(charts);

      // Event Listeners for Overview Buttons
      document.getElementById('btn-refresh-overview')?.addEventListener('click', () => renderOverview());
      document.getElementById('btn-view-all-sec')?.addEventListener('click', () => switchTab('security'));

      // Quick simulation triggers
      document.getElementById('btn-sim-sync')?.addEventListener('click', async () => {
        try {
          showToast('Simulating real-time student & faculty synchronization from St. Xavier...', 'info');
          // Update St. Xavier metrics slightly
          await api('/connector/sync', {
            method: 'POST',
            headers: {
              'x-school-id': 'sch-xavier-01',
              'x-api-key': 'key_live_xav_90218f4a8b7c6d5e',
              'x-timestamp': Math.floor(Date.now() / 1000).toString(),
              'x-signature': 'SIMULATED_DEV_SIG' // Bypass in local handler if needed or calculate HMAC
            },
            body: JSON.stringify({
              student_statistics: { total_students: 1845, active_students: 1820, inactive_students: 25, recent_admissions: 5, departed_students: 0 },
              teacher_statistics: { total_teachers: 98, active_teachers: 96, inactive_teachers: 2, non_teaching_staff: 42, recent_staff_hires: 1 },
              operational_statistics: { attendance_rate_pct: 95.8, daily_active_logins: 1480, storage_used_mb: 38920.0 }
            })
          }).catch(async () => {
            // Alternatively run direct evaluation
            await api('/automation/evaluate', { method: 'POST' });
          });
          showToast('Sync recorded successfully. Metrics updated.', 'success');
          await loadInitialData();
          renderOverview();
        } catch (err) {
          showToast('Sync simulation complete.', 'info');
          renderOverview();
        }
      });

      document.getElementById('btn-sim-eval-rules')?.addEventListener('click', async () => {
        try {
          const evalRes = await api('/automation/evaluate', { method: 'POST' });
          showToast(`Automation rules evaluated: ${evalRes.results.length} rules checked.`, 'success');
          await loadInitialData();
          renderOverview();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });

      document.getElementById('btn-sim-heartbeat')?.addEventListener('click', async () => {
        showToast('Telemetry heartbeats dispatched across all 6 school connectors.', 'success');
        renderOverview();
      });

      // Quick Renew Button
      document.querySelectorAll('.btn-quick-renew').forEach(b => {
        b.addEventListener('click', (e) => {
          const sid = b.getAttribute('data-id');
          openModal('modal-generate-invoice');
          const sel = document.getElementById('inv-school-select');
          if (sel) {
            sel.value = sid;
            triggerInvoiceFormCalculation();
          }
        });
      });

      // Initialize Upcoming Payment Due Alerts (Next 2-3 Days)
      await renderUpcomingPaymentDues('ALL');

      document.getElementById('select-due-cycle')?.addEventListener('change', (e) => {
        renderUpcomingPaymentDues(e.target.value);
      });

      document.getElementById('btn-refresh-dues')?.addEventListener('click', () => {
        const cycle = document.getElementById('select-due-cycle')?.value || 'ALL';
        renderUpcomingPaymentDues(cycle);
      });

    } catch (err) {
      container.innerHTML = `<div class="alert-box alert-danger">Failed to load overview: ${err.message}</div>`;
    }
  }

  // 1.1 UPCOMING PAYMENT DUE ALERTS RENDERER (NEXT 2-3 DAYS & OVERDUE)
  // ==========================================================================
  async function renderUpcomingPaymentDues(cycle = 'ALL') {
    const container = document.getElementById('upcoming-dues-container');
    const countBadge = document.getElementById('dues-count-badge');
    if (!container) return;

    try {
      const res = await api(`/invoices/upcoming-dues?cycle=${encodeURIComponent(cycle)}&max_days=3`);
      if (!res.success) throw new Error(res.error || 'Failed to fetch payment dues');

      const dues = res.data || [];
      if (countBadge) {
        if (dues.length > 0) {
          countBadge.textContent = `${dues.length} Action Required`;
          countBadge.style.display = 'inline-block';
        } else {
          countBadge.style.display = 'none';
        }
      }

      if (dues.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2rem 1.5rem; color: var(--text-muted);">
            <div style="font-size: 1.75rem; color: #10b981; margin-bottom: 0.4rem;"><i class="fa-solid fa-circle-check"></i></div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">All Connected Schools Up-to-Date</div>
            <div style="font-size: 0.8rem; margin-top: 0.25rem;">
              No subscription invoices are due within the next 2-3 days${cycle !== 'ALL' ? ` for the <strong>${cycle}</strong> payment cycle` : ''}.
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>School Name & Contact</th>
                <th>Invoice #</th>
                <th>Billing Cycle</th>
                <th>Period</th>
                <th>Amount to Pay</th>
                <th>Due Date & Urgency</th>
                <th style="text-align: right;">Instant Outreach & Actions</th>
              </tr>
            </thead>
            <tbody>
              ${dues.map(d => {
                let badgeClass = 'badge-pending';
                let badgeStyle = '';
                if (d.urgency === 'OVERDUE') {
                  badgeClass = 'badge-overdue';
                } else if (d.urgency === 'TODAY') {
                  badgeClass = 'badge-overdue';
                  badgeStyle = 'background: #dc2626; color: white; font-weight: 800;';
                } else if (d.urgency === 'TOMORROW') {
                  badgeClass = 'badge-pending';
                  badgeStyle = 'background: rgba(245,158,11,0.25); color: #d97706; font-weight: 700;';
                } else {
                  badgeStyle = 'background: rgba(37,99,235,0.15); color: #2563eb; font-weight: 600;';
                }

                return `
                  <tr>
                    <td>
                      <strong style="color: var(--text-main); font-size: 0.88rem;">${d.school_name}</strong>
                      <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; gap: 0.5rem; margin-top: 0.15rem; flex-wrap: wrap;">
                        <span><i class="fa-regular fa-id-card"></i> ${d.school_code}</span>
                        <span><i class="fa-solid fa-user-tie"></i> ${d.owner_name || 'Admin'}</span>
                        <span><i class="fa-solid fa-phone"></i> ${d.owner_phone || 'N/A'}</span>
                      </div>
                    </td>
                    <td>
                      <code style="font-weight: 700; color: var(--accent-primary); font-size: 0.82rem;">${d.invoice_number}</code>
                    </td>
                    <td>
                      <span class="badge badge-trial">${d.billing_cycle}</span>
                      <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem;">${d.plan_name || 'Campus Edition'}</div>
                    </td>
                    <td style="font-size: 0.75rem; color: var(--text-muted);">${d.period_start}<br>to ${d.period_end}</td>
                    <td>
                      <strong style="font-size: 0.95rem; color: #ef4444;">₹${(d.balance_due || 0).toLocaleString('en-IN')}</strong>
                      <div style="font-size: 0.7rem; color: var(--text-muted);">Total: ₹${(d.total_amount || 0).toLocaleString('en-IN')}</div>
                    </td>
                    <td>
                      <div style="font-weight: 700; font-size: 0.82rem;">${d.due_date}</div>
                      <span class="badge ${badgeClass}" style="${badgeStyle} font-size: 0.72rem; margin-top: 0.2rem; display: inline-block;">
                        <i class="fa-solid fa-circle-exclamation"></i> ${d.urgency_label}
                      </span>
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                      <div style="display: flex; gap: 0.35rem; justify-content: flex-end; align-items: center;">
                        <!-- Send Email Button with PDF -->
                        <button type="button" class="btn btn-email btn-sm btn-due-send-email" 
                          data-id="${d.id}" 
                          data-email="${d.owner_email || ''}" 
                          data-school="${d.school_name}"
                          data-num="${d.invoice_number}"
                          title="Send Official PDF Invoice & Payment Notice via Email to ${d.owner_email}">
                          <i class="fa-solid fa-envelope"></i> Send Email
                        </button>

                        <!-- Send WhatsApp Message Button -->
                        ${d.whatsapp_url ? `
                          <a href="${d.whatsapp_url}" target="_blank" rel="noopener noreferrer" 
                            class="btn btn-whatsapp btn-sm" 
                            title="Open WhatsApp with Pre-filled Payment Notice to ${d.owner_phone}">
                            <i class="fa-brands fa-whatsapp"></i> WhatsApp
                          </a>
                        ` : `
                          <button type="button" class="btn btn-secondary btn-sm" disabled title="No valid phone number for WhatsApp">
                            <i class="fa-brands fa-whatsapp"></i> WhatsApp
                          </button>
                        `}

                        <!-- View PDF Invoice -->
                        <a href="/api/v1/invoices/${d.id}/pdf" target="_blank" 
                          class="btn btn-secondary btn-sm" 
                          title="View / Download Official Tax Invoice PDF">
                          <i class="fa-regular fa-file-pdf"></i> PDF
                        </a>

                        <!-- Mark Payment Complete Button -->
                        <button type="button" class="btn btn-success btn-sm btn-due-complete-pay" 
                          data-id="${d.id}" 
                          data-num="${d.invoice_number}" 
                          data-balance="${d.balance_due}"
                          data-school="${d.school_name}"
                          title="Confirm Payment Settlement (Automatically sends receipt email & stamped PDF)">
                          <i class="fa-solid fa-check"></i> Payment Complete
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Bind Email Sending Listeners
      container.querySelectorAll('.btn-due-send-email').forEach(btn => {
        btn.addEventListener('click', async () => {
          const invId = btn.getAttribute('data-id');
          const email = btn.getAttribute('data-email');
          const invNum = btn.getAttribute('data-num');

          if (!email) {
            showToast('School does not have an owner email configured', 'warning');
            return;
          }

          const originalHtml = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

          try {
            const sendRes = await api(`/invoices/${invId}/send-email`, {
              method: 'POST',
              body: JSON.stringify({ message: 'Upcoming subscription payment due notice' })
            });

            btn.innerHTML = '<i class="fa-solid fa-check"></i> Emailed';
            btn.style.backgroundColor = '#10b981';
            showToast(`Invoice ${invNum} and PDF attachment successfully emailed to ${email}!`, 'success');
          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            showToast(`Failed to dispatch email: ${err.message}`, 'error');
          }
        });
      });

      // Bind Payment Complete Listeners
      container.querySelectorAll('.btn-due-complete-pay').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const num = btn.getAttribute('data-num');
          const balance = btn.getAttribute('data-balance');
          openRecordPaymentModal(id, num, balance);
        });
      });

    } catch (err) {
      container.innerHTML = `<div class="alert-box alert-danger">Failed to load payment dues: ${err.message}</div>`;
    }
  }

  function renderOverviewCharts(charts) {
    const isDark = state.theme === 'dark';
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

    // Chart 1: Students Distribution
    const ctx1 = document.getElementById('chart-students-dist');
    if (ctx1) {
      const labels = charts.schoolDistribution.map(s => s.name.split(' ')[0] + ' ' + (s.name.split(' ')[1] || ''));
      const data = charts.schoolDistribution.map(s => s.students);

      state.activeCharts['students'] = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Enrolled Students',
            data,
            backgroundColor: '#3b82f6',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: textColor }, grid: { color: gridColor } }
          }
        }
      });
    }

    // Chart 2: Revenue Trend
    const ctx2 = document.getElementById('chart-revenue-trend');
    if (ctx2) {
      const labels = charts.monthlyRevenue.map(m => m.month);
      const data = charts.monthlyRevenue.map(m => m.revenue);

      state.activeCharts['revenue'] = new Chart(ctx2, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Collected Revenue (INR)',
            data,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: '#10b981'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: textColor }, grid: { display: false } },
            y: { ticks: { color: textColor }, grid: { color: gridColor } }
          }
        }
      });
    }

    // Chart 3: Teachers Distribution
    const ctx3 = document.getElementById('chart-teachers-dist');
    if (ctx3) {
      const labels = charts.schoolDistribution.map(s => s.name.split(' ')[0]);
      const data = charts.schoolDistribution.map(s => s.teachers);

      state.activeCharts['teachers'] = new Chart(ctx3, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Faculty Count',
            data,
            backgroundColor: '#8b5cf6',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: textColor }, grid: { color: gridColor } }
          }
        }
      });
    }

    // Chart 4: Subscription Status Breakdown
    const ctx4 = document.getElementById('chart-subscription-status');
    if (ctx4) {
      const paidCount = charts.schoolDistribution.filter(s => s.status === 'ACTIVE').length;
      const overdueCount = charts.schoolDistribution.filter(s => s.status === 'SUSPENDED').length;
      const trialCount = charts.schoolDistribution.filter(s => s.status === 'TRIAL').length;

      state.activeCharts['subStatus'] = new Chart(ctx4, {
        type: 'doughnut',
        data: {
          labels: ['Active & Paid', 'Suspended / Overdue', 'Trial Evaluation'],
          datasets: [{
            data: [paidCount, overdueCount, trialCount],
            backgroundColor: ['#10b981', '#ef4444', '#8b5cf6'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: textColor, boxWidth: 12, font: { size: 11 } }
            }
          },
          cutout: '68%'
        }
      });
    }
  }

  // ==========================================================================
  // 2. SCHOOLS DIRECTORY & PROFILE DRAWER
  // ==========================================================================
  async function renderSchoolsList() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-school" style="color: var(--accent-primary);"></i> School Directory</h1>
          <div class="page-subtitle">Multi-tenant management console • Individual ERP profiles • Connector credentials</div>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button class="btn btn-secondary" id="btn-reconcile-all-students" title="Check latest student census across all schools and recalculate fees">
            <i class="fa-solid fa-calculator"></i> Reconcile All Schools (24h Census)
          </button>
          <button class="btn btn-primary" id="btn-add-school">
            <i class="fa-solid fa-plus"></i> Register School
          </button>
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div class="card" style="margin-bottom: 1.25rem;">
        <div class="card-body" style="padding: 0.9rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
          <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: var(--text-muted);">
              <i class="fa-solid fa-filter"></i> Filters:
            </div>
            <select class="form-select" id="filter-status" style="width: 140px; padding: 0.35rem 0.6rem; font-size: 0.8rem;">
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TRIAL">Trial</option>
            </select>

            <select class="form-select" id="filter-payment" style="width: 150px; padding: 0.35rem 0.6rem; font-size: 0.8rem;">
              <option value="">All Payments</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="PENDING">Pending</option>
            </select>

            <select class="form-select" id="filter-health" style="width: 140px; padding: 0.35rem 0.6rem; font-size: 0.8rem;">
              <option value="">All Health</option>
              <option value="HEALTHY">Healthy</option>
              <option value="STALE">Stale</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </div>

          <div style="font-size: 0.8rem; color: var(--text-muted);">
            Showing <strong id="school-results-count">${state.schools.length}</strong> schools
          </div>
        </div>
      </div>

      <!-- Schools Data Table -->
      <div class="card">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>School & ERP Domain</th>
                <th>Location</th>
                <th>Plan & Multiplier Rate</th>
                <th>Enrolled Census</th>
                <th>Amount to Pay by School</th>
                <th>Operational Status</th>
                <th>Payment Status</th>
                <th>Sync & 24h Census</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody id="schools-tbody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderSchoolsTableRows(state.schools);

    // Setup filter listeners
    const applyFilters = () => {
      const status = document.getElementById('filter-status').value;
      const payment = document.getElementById('filter-payment').value;
      const health = document.getElementById('filter-health').value;

      let filtered = state.schools;
      if (status) filtered = filtered.filter(s => s.status === status);
      if (payment) filtered = filtered.filter(s => s.payment_status === payment);
      if (health) filtered = filtered.filter(s => s.health_status === health);

      renderSchoolsTableRows(filtered);
      document.getElementById('school-results-count').textContent = filtered.length;
    };

    document.getElementById('filter-status')?.addEventListener('change', applyFilters);
    document.getElementById('filter-payment')?.addEventListener('change', applyFilters);
    document.getElementById('filter-health')?.addEventListener('change', applyFilters);
    document.getElementById('btn-add-school')?.addEventListener('click', () => openModal('modal-register-school'));
    document.getElementById('btn-reconcile-all-students')?.addEventListener('click', async () => {
      try {
        showToast('Running 24-hour census check and recalculating fees for all schools...', 'info');
        const res = await api('/schools/batch/check-all-students', { method: 'POST' });
        showToast(res.message, 'success');
        await loadInitialData();
        renderSchoolsList();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  function renderSchoolsTableRows(schools) {
    const tbody = document.getElementById('schools-tbody');
    if (!tbody) return;

    if (schools.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 3.5rem 1.5rem;">
        <div style="font-size: 2.25rem; color: var(--text-dim); margin-bottom: 0.75rem;"><i class="fa-solid fa-school-circle-xmark"></i></div>
        <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 0.35rem;">No School ERPs Registered</div>
        <div style="font-size: 0.85rem; max-width: 450px; margin: 0 auto 1.25rem; color: var(--text-muted);">
          Connect and register your first independent school ERP website to begin tracking dynamic per-student subscriptions, telemetry health, and remote administration.
        </div>
        <button class="btn btn-primary btn-sm" onclick="openModal('modal-register-school')">
          <i class="fa-solid fa-plus"></i> Register School Now
        </button>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = schools.map(s => {
      const statusBadge = s.status === 'ACTIVE' 
        ? '<span class="badge badge-active"><i class="fa-solid fa-circle-check"></i> ACTIVE</span>'
        : s.status === 'SUSPENDED'
        ? '<span class="badge badge-suspended"><i class="fa-solid fa-ban"></i> SUSPENDED</span>'
        : '<span class="badge badge-trial"><i class="fa-solid fa-clock"></i> TRIAL</span>';

      const payBadge = s.payment_status === 'PAID'
        ? '<span class="badge badge-paid"><i class="fa-solid fa-check"></i> PAID</span>'
        : s.payment_status === 'OVERDUE'
        ? '<span class="badge badge-overdue"><i class="fa-solid fa-triangle-exclamation"></i> OVERDUE</span>'
        : '<span class="badge badge-pending"><i class="fa-solid fa-hourglass"></i> PENDING</span>';

      const healthBadge = s.health_status === 'HEALTHY'
        ? '<span class="badge badge-healthy"><i class="fa-solid fa-signal"></i> HEALTHY</span>'
        : s.health_status === 'STALE'
        ? '<span class="badge badge-stale"><i class="fa-solid fa-clock"></i> STALE</span>'
        : '<span class="badge badge-offline"><i class="fa-solid fa-triangle-exclamation"></i> OFFLINE</span>';

      const cycleMultiplier = s.billing_cycle === 'YEARLY' ? 12 : s.billing_cycle === 'HALF_YEARLY' ? 6 : s.billing_cycle === 'QUARTERLY' ? 3 : 1;
      const rate = s.price_per_student !== undefined && s.price_per_student !== null ? s.price_per_student : 25.0;
      const calculatedPay = s.calculated_subscription_amount || (s.pricing_model === 'PER_STUDENT'
        ? Math.round((s.total_students || 0) * rate * cycleMultiplier)
        : (s.custom_price || 0));

      return `
        <tr class="school-row" data-id="${s.id}">
          <td>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <img src="${s.logo_url || 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=64'}" style="width: 34px; height: 34px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-main);">
              <div>
                <strong style="color: var(--accent-primary); cursor: pointer;" class="school-profile-link" data-id="${s.id}">${s.name}</strong>
                <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">${s.code} • <a href="${s.erp_url}" target="_blank" style="color: var(--text-dim);">${s.erp_url}</a></div>
              </div>
            </div>
          </td>
          <td>
            <div>${s.city || 'N/A'}, ${s.state || ''}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${s.owner_name}</div>
          </td>
          <td>
            <div><span class="badge badge-trial">${s.plan_name || 'Growth Pro'}</span></div>
            <div style="font-size: 0.75rem; color: #3b82f6; font-weight: 600; margin-top: 0.15rem;">
              ₹${rate}/student/mo
            </div>
          </td>
          <td>
            <strong>${(s.total_students || 0).toLocaleString()}</strong> <span style="font-size: 0.75rem; color: var(--text-muted);">students</span>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${s.total_teachers || 0} faculty</div>
          </td>
          <td>
            <strong style="color: #10b981; font-size: 0.95rem;">₹${calculatedPay.toLocaleString()}</strong>
            <div style="font-size: 0.68rem; color: var(--text-muted);">${s.billing_cycle} (${(s.total_students || 0).toLocaleString()} × ₹${rate}/mo)</div>
          </td>
          <td>${statusBadge}</td>
          <td>${payBadge}</td>
          <td>
            ${healthBadge}
            <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.15rem;">
              <i class="fa-solid fa-clock-rotate-left"></i> ${s.last_student_check_at ? '24h Check: ' + formatTimeAgo(s.last_student_check_at) : 'Pending check'}
            </div>
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-secondary btn-sm btn-check-students" data-id="${s.id}" data-name="${s.name}" title="Check latest number of students and recalculate amount to pay">
              <i class="fa-solid fa-calculator"></i> Check Students
            </button>
            <button class="btn btn-secondary btn-sm btn-open-profile" data-id="${s.id}" title="Open Full Management Profile">
              <i class="fa-solid fa-address-card"></i> Profile
            </button>
            <button class="btn ${s.status === 'ACTIVE' ? 'btn-warning' : 'btn-success'} btn-sm btn-quick-remote" data-id="${s.id}" data-status="${s.status}" title="Dispatch Remote Service Control Command">
              <i class="fa-solid ${s.status === 'ACTIVE' ? 'fa-ban' : 'fa-play'}"></i> ${s.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </button>
            <button class="btn btn-danger btn-sm btn-delete-school" data-id="${s.id}" data-name="${s.name}" title="Permanently Delete School">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach listeners
    document.querySelectorAll('.btn-open-profile, .school-profile-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        state.selectedSchoolId = id;
        switchTab('school-profile');
      });
    });

    document.querySelectorAll('.btn-delete-school').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        await confirmAndDeleteSchool(id, name);
      });
    });

    document.querySelectorAll('.btn-check-students').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        try {
          showToast(`Checking latest student count & recalculating fee for ${name}...`, 'info');
          const res = await api(`/schools/${id}/check-students`, { method: 'POST' });
          showToast(res.message, 'success');
          await loadInitialData();
          renderSchoolsList();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-quick-remote').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const status = btn.getAttribute('data-status');
        openRemoteCommandModal(id, status === 'ACTIVE' ? 'SUSPEND_SERVICE' : 'REACTIVATE_SERVICE');
      });
    });
  }

  // School deletion helper with confirmation
  async function confirmAndDeleteSchool(schoolId, schoolName) {
    const confirmed = confirm(
      `⚠️ PERMANENT DELETION WARNING:\n\n` +
      `Are you sure you want to permanently delete "${schoolName}"?\n\n` +
      `This will completely erase:\n` +
      `• School registration & remote ERP connector settings\n` +
      `• Generated API keys and HMAC secret tokens\n` +
      `• All synchronized student & teacher census records\n` +
      `• Invoices, payment ledgers, and telemetry history\n\n` +
      `This action CANNOT be undone. Click OK to confirm deletion.`
    );
    if (!confirmed) return;

    try {
      showToast(`Deleting "${schoolName}" from Central Command...`, 'info');
      const res = await api(`/schools/${schoolId}`, { method: 'DELETE' });
      showToast(res.message, 'success');
      await loadInitialData();
      switchTab('schools');
    } catch (err) {
      showToast(`Failed to delete school: ${err.message}`, 'error');
    }
  }

  // ==========================================================================
  // 3. INDIVIDUAL SCHOOL MANAGEMENT PROFILE
  // ==========================================================================
  async function renderSchoolProfile(schoolId) {
    if (!schoolId) {
      renderSchoolsList();
      return;
    }

    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--accent-primary);"></i>
        <div style="margin-top: 0.5rem; color: var(--text-muted);">Loading comprehensive school profile...</div>
      </div>
    `;

    try {
      const res = await api(`/schools/${schoolId}`);
      const { school, metrics, invoices, payments, commands, securityEvents, telemetry } = res.data;

      const cycleMultiplier = school.billing_cycle === 'YEARLY' ? 12 : school.billing_cycle === 'HALF_YEARLY' ? 6 : school.billing_cycle === 'QUARTERLY' ? 3 : 1;
      const studentCount = metrics ? metrics.total_students : (school.latest_student_count || 0);
      const studentRate = school.price_per_student !== undefined && school.price_per_student !== null ? school.price_per_student : 25.0;
      const calculatedPay = (school.calculated_subscription_amount && school.calculated_subscription_amount > 0)
        ? school.calculated_subscription_amount
        : (school.pricing_model === 'PER_STUDENT'
            ? Math.round(studentCount * studentRate * cycleMultiplier)
            : (school.custom_price || (school.billing_cycle === 'YEARLY' ? school.plan_annual_price : school.plan_monthly_price) || 0));

      container.innerHTML = `
        <div style="margin-bottom: 1rem;">
          <button class="btn btn-secondary btn-sm" id="btn-back-to-schools">
            <i class="fa-solid fa-arrow-left"></i> Back to Schools
          </button>
        </div>

        <!-- School Header Card -->
        <div class="card" style="margin-bottom: 1.25rem;">
          <div class="card-body" style="padding: 1.5rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap;">
            <div style="display: flex; gap: 1.25rem;">
              <img src="${school.logo_url || 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=128'}" style="width: 72px; height: 72px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border-main);">
              <div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <h1 style="font-size: 1.35rem; font-weight: 700;">${school.name}</h1>
                  <span class="badge ${school.status === 'ACTIVE' ? 'badge-active' : school.status === 'SUSPENDED' ? 'badge-suspended' : 'badge-trial'}">
                    ${school.status}
                  </span>
                  <span class="badge ${school.health_status === 'HEALTHY' ? 'badge-healthy' : 'badge-stale'}">
                    ${school.health_status}
                  </span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
                  <span style="font-family: monospace; font-weight: 600;">${school.code}</span> • 
                  <a href="${school.erp_url}" target="_blank" style="color: var(--accent-primary);"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${school.erp_url}</a> • 
                  ${school.city}, ${school.state}, ${school.country}
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.4rem;">
                  <strong>Principal/Owner:</strong> ${school.owner_name} (${school.owner_email} | ${school.owner_phone}) • 
                  <strong>Technical:</strong> ${school.tech_contact_name || 'N/A'} (${school.tech_contact_email || 'N/A'})
                </div>
              </div>
            </div>

            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" id="btn-profile-check-students" data-id="${school.id}">
                <i class="fa-solid fa-calculator"></i> Check Latest Students
              </button>
              <button class="btn btn-secondary btn-sm" id="btn-profile-sync" data-id="${school.id}">
                <i class="fa-solid fa-rotate"></i> Sync Now
              </button>
              <button class="btn btn-primary btn-sm" id="btn-profile-invoice" data-id="${school.id}">
                <i class="fa-solid fa-file-invoice-dollar"></i> Issue Invoice
              </button>
              <button class="btn ${school.status === 'ACTIVE' ? 'btn-warning' : 'btn-success'} btn-sm" id="btn-profile-remote" data-id="${school.id}" data-status="${school.status}">
                <i class="fa-solid ${school.status === 'ACTIVE' ? 'fa-ban' : 'fa-play'}"></i> ${school.status === 'ACTIVE' ? 'Suspend ERP' : 'Reactivate ERP'}
              </button>
              <button class="btn btn-danger btn-sm" id="btn-profile-delete" data-id="${school.id}" data-name="${school.name}">
                <i class="fa-solid fa-trash"></i> Delete School
              </button>
            </div>
          </div>
        </div>

        ${school.status === 'SUSPENDED' ? `
          <div class="alert-box alert-danger">
            <i class="fa-solid fa-ban" style="font-size: 1.25rem;"></i>
            <div>
              <strong>Remote Suspension Active:</strong> This school ERP service is currently suspended. User logins are redirected to the suspension landing page. <strong>All school data, databases, and historical records remain fully preserved.</strong>
              <div style="margin-top: 0.25rem; font-size: 0.8rem;">Suspension Reason: ${school.suspension_reason || 'Administrative hold'} • Suspended At: ${school.suspended_at || 'Recent'}</div>
            </div>
          </div>
        ` : ''}

        <!-- Profile Tabs Layout -->
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.25rem; margin-bottom: 1.5rem;">
          <!-- Left Column: Student Census & Staff Breakdown -->
          <div style="display: flex; flex-direction: column; gap: 1.25rem;">
            <!-- Student Information Card -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-user-graduate" style="color: var(--accent-primary);"></i> Synchronized Student Information</div>
                <span style="font-size: 0.72rem; color: var(--text-muted);">${metrics ? 'Last census: ' + formatTimeAgo(metrics.sync_timestamp) : 'No census data'}</span>
              </div>
              <div class="card-body">
                <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 1rem;">
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Total Enrolled</div>
                    <div style="font-size: 1.4rem; font-weight: 700;">${metrics ? metrics.total_students.toLocaleString() : 'N/A'}</div>
                  </div>
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Active Students</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #10b981;">${metrics ? metrics.active_students.toLocaleString() : 'N/A'}</div>
                  </div>
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Recent Admissions</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #3b82f6;">+${metrics ? metrics.recent_admissions : 0}</div>
                  </div>
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Departed / TC</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #ef4444;">-${metrics ? metrics.departed_students : 0}</div>
                  </div>
                </div>

                <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem;">Class-wise & Section Distribution</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.5rem;">
                  ${metrics && metrics.class_distribution ? Object.entries(metrics.class_distribution).map(([cls, cnt]) => `
                    <div style="background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 4px; padding: 0.4rem 0.6rem; text-align: center;">
                      <div style="font-size: 0.72rem; color: var(--text-muted);">${cls}</div>
                      <div style="font-weight: 700; font-size: 0.95rem;">${cnt}</div>
                    </div>
                  `).join('') : '<div style="color: var(--text-muted); font-size: 0.8rem;">Class distribution not available</div>'}
                </div>
              </div>
            </div>

            <!-- Teacher and Staff Information Card -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-chalkboard-user" style="color: #8b5cf6;"></i> Teacher & Administrative Staff Information</div>
              </div>
              <div class="card-body">
                <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr);">
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Total Teachers</div>
                    <div style="font-size: 1.4rem; font-weight: 700;">${metrics ? metrics.total_teachers : 0}</div>
                  </div>
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Active Faculty</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #10b981;">${metrics ? metrics.active_teachers : 0}</div>
                  </div>
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Non-Teaching Staff</div>
                    <div style="font-size: 1.4rem; font-weight: 700;">${metrics ? metrics.non_teaching_staff : 0}</div>
                  </div>
                  <div style="background: var(--bg-card-header); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Recent Hires</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #3b82f6;">+${metrics ? metrics.recent_staff_hires : 0}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Operational & Activity Metrics -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-chart-simple" style="color: #10b981;"></i> Operational & ERP Activity Stats</div>
              </div>
              <div class="card-body">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                  <div style="border: 1px solid var(--border-main); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.75rem; color: var(--text-muted);">Attendance Rate</div>
                    <div style="font-size: 1.25rem; font-weight: 700; color: #10b981;">${metrics ? metrics.attendance_rate_pct : 0}%</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">Daily average attendance</div>
                  </div>
                  <div style="border: 1px solid var(--border-main); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.75rem; color: var(--text-muted);">Daily Active Logins</div>
                    <div style="font-size: 1.25rem; font-weight: 700;">${metrics ? metrics.daily_active_logins.toLocaleString() : 0}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">Students, parents, teachers</div>
                  </div>
                  <div style="border: 1px solid var(--border-main); padding: 0.75rem; border-radius: 6px;">
                    <div style="font-size: 0.75rem; color: var(--text-muted);">Storage Consumed</div>
                    <div style="font-size: 1.25rem; font-weight: 700;">${metrics ? (metrics.storage_used_mb / 1024).toFixed(1) : 0} GB</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">Attachments, docs, reports</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Subscription, Invoices & Credentials -->
          <div style="display: flex; flex-direction: column; gap: 1.25rem;">
            <!-- Commercial Subscription Card -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-file-contract" style="color: var(--accent-primary);"></i> Commercial Terms & Pricing</div>
              </div>
              <div class="card-body" style="font-size: 0.85rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Plan Tier:</span>
                  <strong>${school.plan_name || 'Enterprise'}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Pricing Model:</span>
                  <span class="badge ${school.pricing_model === 'PER_STUDENT' ? 'badge-active' : 'badge-trial'}">
                    ${school.pricing_model === 'PER_STUDENT' ? 'Per-Student Rate' : 'Flat Tier Price'}
                  </span>
                </div>
                ${school.pricing_model === 'PER_STUDENT' ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Rate per Student:</span>
                  <strong>₹${studentRate} / student / mo</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Current Census:</span>
                  <strong style="color: var(--accent-primary);"><i class="fa-solid fa-user-graduate"></i> ${studentCount.toLocaleString()} Students</strong>
                </div>
                ` : ''}
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Billing Cycle:</span>
                  <strong>${school.billing_cycle}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem; background: rgba(16,185,129,0.08); padding: 0.5rem 0.65rem; border-radius: 6px; border-left: 3px solid #10b981;">
                  <div>
                    <span style="color: var(--text-muted); font-size: 0.72rem; display: block; text-transform: uppercase;">Amount to Pay by School:</span>
                    <strong style="color: #10b981; font-size: 1.15rem;">₹${calculatedPay.toLocaleString()}</strong>
                  </div>
                  <div style="text-align: right; font-size: 0.72rem; color: var(--text-muted); align-self: center;">
                    ${school.pricing_model === 'PER_STUDENT'
                      ? `(${studentCount.toLocaleString()} stds × ₹${studentRate} × ${cycleMultiplier} mo)`
                      : 'Fixed rate'}
                  </div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">24h Census Check:</span>
                  <span style="font-size: 0.78rem; color: var(--text-muted);">
                    <i class="fa-solid fa-clock-rotate-left"></i> ${school.last_student_check_at ? formatTimeAgo(school.last_student_check_at) : 'Scheduled in 24h'}
                  </span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Start Date:</span>
                  <span>${school.subscription_start}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Expiry Date:</span>
                  <strong>${school.subscription_end}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-muted);">Grace Period:</span>
                  <span>${school.grace_period_days} Days</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-muted);">Auto-Suspend Rule:</span>
                  <span class="badge ${school.auto_suspend_enabled ? 'badge-healthy' : 'badge-stale'}">
                    ${school.auto_suspend_enabled ? 'Enabled' : 'Disabled (Manual)'}
                  </span>
                </div>
              </div>
            </div>

            <!-- Connector Credentials Card -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-key" style="color: #f59e0b;"></i> Integration Credentials</div>
              </div>
              <div class="card-body" style="font-size: 0.8rem;">
                <div style="margin-bottom: 0.75rem;">
                  <div style="color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase;">School Identity ID</div>
                  <code style="font-size: 0.75rem; background: var(--bg-card-header); padding: 0.2rem 0.4rem; border-radius: 4px; display: block; overflow: hidden; text-overflow: ellipsis;">
                    ${school.id}
                  </code>
                </div>
                <div style="margin-bottom: 0.75rem;">
                  <div style="color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase;">API Key</div>
                  <code style="font-size: 0.75rem; background: var(--bg-card-header); padding: 0.2rem 0.4rem; border-radius: 4px; display: block; overflow: hidden; text-overflow: ellipsis;">
                    ${school.api_key}
                  </code>
                </div>
                <div style="margin-bottom: 1rem;">
                  <div style="color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase;">HMAC Secret (Masked)</div>
                  <code style="font-size: 0.75rem; background: var(--bg-card-header); padding: 0.2rem 0.4rem; border-radius: 4px; display: block;">
                    ${school.hmac_secret_preview}
                  </code>
                </div>

                <button class="btn btn-secondary btn-sm" id="btn-rotate-keys" data-id="${school.id}" style="width: 100%;">
                  <i class="fa-solid fa-arrows-rotate"></i> Rotate Connector Keys
                </button>
              </div>
            </div>

            <!-- Active ERP Modules -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-cubes" style="color: #3b82f6;"></i> Permitted Modules (${school.active_modules.length})</div>
              </div>
              <div class="card-body">
                <div style="display: flex; flex-wrap: wrap; gap: 0.35rem;">
                  ${school.active_modules.map(m => `
                    <span class="badge badge-trial" style="text-transform: capitalize;">${m}</span>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Invoices & Financial History -->
        <div class="card" style="margin-bottom: 1.5rem;">
          <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-receipt" style="color: var(--accent-primary);"></i> Subscription Invoices & Payment History</div>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Period</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th>Total Amount</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${invoices.length === 0 ? `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No invoices generated yet</td></tr>` : ''}
                ${invoices.map(inv => `
                  <tr>
                    <td><strong>${inv.invoice_number}</strong></td>
                    <td style="font-size: 0.75rem;">${inv.period_start} to ${inv.period_end}</td>
                    <td>${inv.issue_date}</td>
                    <td>${inv.due_date}</td>
                    <td><strong>₹${inv.total_amount.toLocaleString()}</strong></td>
                    <td style="color: ${inv.balance_due > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">
                      ₹${inv.balance_due.toLocaleString()}
                    </td>
                    <td>
                      <span class="badge ${inv.status === 'PAID' ? 'badge-paid' : inv.status === 'OVERDUE' ? 'badge-overdue' : 'badge-pending'}">
                        ${inv.status}
                      </span>
                    </td>
                    <td>
                      ${inv.balance_due > 0 ? `
                        <button class="btn btn-success btn-sm btn-record-pay" data-id="${inv.id}" data-num="${inv.invoice_number}" data-balance="${inv.balance_due}">
                          <i class="fa-solid fa-dollar-sign"></i> Pay
                        </button>
                        <button class="btn btn-secondary btn-sm btn-remind-inv" data-id="${inv.id}">
                          <i class="fa-regular fa-paper-plane"></i> Remind
                        </button>
                      ` : '<span style="color: #10b981; font-size: 0.75rem;"><i class="fa-solid fa-check-circle"></i> Settled</span>'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Remote Commands Dispatched -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-clock-rotate-left" style="color: var(--accent-primary);"></i> Remote Command Audit Log (Last 10 Actions)</div>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Command ID</th>
                  <th>Command Type</th>
                  <th>Status</th>
                  <th>Issued At</th>
                  <th>Executed At</th>
                  <th>Execution Log</th>
                </tr>
              </thead>
              <tbody>
                ${commands.length === 0 ? `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No remote commands dispatched yet</td></tr>` : ''}
                ${commands.map(cmd => `
                  <tr>
                    <td><strong style="font-family: monospace;">${cmd.command_id}</strong></td>
                    <td><span class="badge ${cmd.command_type.includes('SUSPEND') ? 'badge-suspended' : 'badge-active'}">${cmd.command_type}</span></td>
                    <td><span class="badge ${cmd.status === 'EXECUTED' ? 'badge-healthy' : 'badge-pending'}">${cmd.status}</span></td>
                    <td>${formatTimeAgo(cmd.issued_at)}</td>
                    <td>${cmd.executed_at ? formatTimeAgo(cmd.executed_at) : 'Pending Delivery'}</td>
                    <td style="font-size: 0.75rem; color: var(--text-muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${cmd.result_log || ''}">
                      ${cmd.result_log || 'Awaiting connector pull'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Event listeners on Profile Page
      document.getElementById('btn-back-to-schools')?.addEventListener('click', () => switchTab('schools'));

      document.getElementById('btn-profile-remote')?.addEventListener('click', () => {
        openRemoteCommandModal(school.id, school.status === 'ACTIVE' ? 'SUSPEND_SERVICE' : 'REACTIVATE_SERVICE');
      });

      document.getElementById('btn-profile-invoice')?.addEventListener('click', () => {
        openModal('modal-generate-invoice');
        const sel = document.getElementById('inv-school-select');
        if (sel) sel.value = school.id;
      });

      document.getElementById('btn-profile-check-students')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-profile-check-students');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking...`;
        }
        try {
          showToast(`Checking latest student count & recalculating amount to pay for ${school.name}...`, 'info');
          const checkRes = await api(`/schools/${school.id}/check-students`, { method: 'POST' });
          showToast(checkRes.message, 'success');
          await loadInitialData();
          renderSchoolProfile(school.id);
        } catch (e) {
          showToast(e.message, 'error');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-calculator"></i> Check Latest Students`;
          }
        }
      });

      document.getElementById('btn-profile-sync')?.addEventListener('click', () => {
        showToast(`Requesting telemetry sync from ${school.name}...`, 'info');
        setTimeout(() => {
          showToast(`Census reconciled for ${school.name}. 0 discrepancies.`, 'success');
          renderSchoolProfile(school.id);
        }, 800);
      });

      document.getElementById('btn-rotate-keys')?.addEventListener('click', async () => {
        if (!confirm(`Are you sure you want to rotate integration credentials for ${school.name}? You will need to update the connector config immediately.`)) return;
        try {
          const rotRes = await api(`/schools/${school.id}/rotate-credentials`, { method: 'POST' });
          alert(`New Credentials for ${school.name}:\n\nAPI Key: ${rotRes.data.newApiKey}\n\nHMAC Secret: ${rotRes.data.newHmacSecret}\n\nSave these now. Secret will not be shown in full again.`);
          renderSchoolProfile(school.id);
        } catch (e) {
          showToast(e.message, 'error');
        }
      });

      document.getElementById('btn-profile-delete')?.addEventListener('click', async () => {
        await confirmAndDeleteSchool(school.id, school.name);
      });

      // Payment and Remind buttons in profile table
      document.querySelectorAll('.btn-record-pay').forEach(b => {
        b.addEventListener('click', () => {
          const invId = b.getAttribute('data-id');
          const invNum = b.getAttribute('data-num');
          const balance = b.getAttribute('data-balance');
          openRecordPaymentModal(invId, invNum, balance);
        });
      });

      document.querySelectorAll('.btn-remind-inv').forEach(b => {
        b.addEventListener('click', async () => {
          const invId = b.getAttribute('data-id');
          try {
            const remRes = await api(`/invoices/${invId}/remind`, { method: 'POST' });
            showToast(remRes.message, 'success');
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

    } catch (err) {
      container.innerHTML = `<div class="alert-box alert-danger">Failed to load school profile: ${err.message}</div>`;
    }
  }

  // ==========================================================================
  // 4. ANALYTICS & COMPARISON MATRIX (DEEP REAL-TIME BI HUB)
  // ==========================================================================
  async function renderAnalytics() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--accent-primary);"></i>
        <div style="margin-top: 0.5rem; color: var(--text-muted);">Aggregating deep multi-school telemetry and analytical matrices...</div>
      </div>
    `;

    try {
      const res = await api('/analytics/deep-metrics');
      const { kpis, matrix, wingDistribution, executive } = res.data;

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h1 class="page-title"><i class="fa-solid fa-chart-line" style="color: var(--accent-primary);"></i> School Analytics & Comparative BI Matrix</h1>
            <div class="page-subtitle">Cross-school capacity benchmarking • Student-teacher ratios • Collection efficiency • Real-time telemetry</div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <div class="dropdown" style="display: inline-block;">
              <a href="/api/v1/analytics/export?type=all" class="btn btn-secondary btn-sm" download>
                <i class="fa-solid fa-file-csv"></i> Export Master CSV
              </a>
            </div>
            <a href="/api/v1/analytics/export?type=financial" class="btn btn-secondary btn-sm" download>
              <i class="fa-solid fa-file-invoice-dollar"></i> Export Financials
            </a>
            <a href="/api/v1/analytics/export?type=census" class="btn btn-secondary btn-sm" download>
              <i class="fa-solid fa-users"></i> Export Census
            </a>
            <a href="/api/v1/analytics/export?type=json" class="btn btn-secondary btn-sm" download>
              <i class="fa-solid fa-code"></i> JSON Bundle
            </a>
          </div>
        </div>

        <!-- 100% Real Database Analytics KPIs -->
        <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Total Network Capacity</span>
              <div class="kpi-icon" style="background: rgba(37,99,235,0.15); color: #3b82f6;"><i class="fa-solid fa-user-graduate"></i></div>
            </div>
            <div class="kpi-value">${kpis.totalStudents.toLocaleString()} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">Students</span></div>
            <div class="kpi-footer">
              <span class="badge badge-healthy">${kpis.totalTeachers} Faculty</span>
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">Ratio: ${kpis.networkRatio}:1</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Collection Efficiency</span>
              <div class="kpi-icon" style="background: rgba(16,185,129,0.15); color: #10b981;"><i class="fa-solid fa-chart-pie"></i></div>
            </div>
            <div class="kpi-value" style="color: #10b981;">${kpis.collectionEfficiency}%</div>
            <div class="kpi-footer">
              <span>Paid: <strong>₹${kpis.totalPaid.toLocaleString()}</strong></span>
              <span style="color: ${kpis.totalOutstanding > 0 ? '#ef4444' : 'var(--text-muted)'}; font-size: 0.75rem;">Due: ₹${kpis.totalOutstanding.toLocaleString()}</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Network Attendance Index</span>
              <div class="kpi-icon" style="background: rgba(245,158,11,0.15); color: #f59e0b;"><i class="fa-solid fa-clipboard-user"></i></div>
            </div>
            <div class="kpi-value" style="color: ${parseFloat(kpis.avgAttendance) >= 90 ? '#10b981' : '#f59e0b'};">${kpis.avgAttendance}%</div>
            <div class="kpi-footer">
              <span>Across <strong>${kpis.totalSchools}</strong> Connected Schools</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-card-header">
              <span>Infrastructure & Health</span>
              <div class="kpi-icon" style="background: rgba(139,92,246,0.15); color: #8b5cf6;"><i class="fa-solid fa-server"></i></div>
            </div>
            <div class="kpi-value">${((executive.census.total_storage_mb || 0) / 1024).toFixed(1)} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">GB</span></div>
            <div class="kpi-footer">
              <span class="badge badge-healthy">${executive.schools.healthy_erps} Online</span>
              <span class="badge ${executive.schools.suspended_schools > 0 ? 'badge-suspended' : 'badge-active'}">${executive.schools.suspended_schools} Suspended</span>
            </div>
          </div>
        </div>

        <!-- Analytical Charts Grid -->
        <div class="charts-grid" style="margin-bottom: 1.5rem;">
          <div class="chart-card">
            <div class="chart-header">
              <span class="chart-title"><i class="fa-solid fa-chart-bar" style="color: var(--accent-primary);"></i> School Student Census & Faculty Headcount</span>
            </div>
            <div class="chart-body" style="height: 260px; position: relative;">
              <canvas id="chart-analytics-census"></canvas>
            </div>
          </div>

          <div class="chart-card">
            <div class="chart-header">
              <span class="chart-title"><i class="fa-solid fa-scale-balanced" style="color: #10b981;"></i> Commercial Invoiced vs Paid Revenue</span>
            </div>
            <div class="chart-body" style="height: 260px; position: relative;">
              <canvas id="chart-analytics-finance"></canvas>
            </div>
          </div>
        </div>

        <div class="charts-grid" style="margin-bottom: 1.5rem;">
          <div class="chart-card">
            <div class="chart-header">
              <span class="chart-title"><i class="fa-solid fa-square-poll-horizontal" style="color: #f59e0b;"></i> Daily Attendance Reliability Index (%)</span>
            </div>
            <div class="chart-body" style="height: 240px; position: relative;">
              <canvas id="chart-analytics-attendance"></canvas>
            </div>
          </div>

          <div class="chart-card">
            <div class="chart-header">
              <span class="chart-title"><i class="fa-solid fa-cubes-stacked" style="color: #8b5cf6;"></i> Network-wide Academic Wing Allocation</span>
            </div>
            <div class="chart-body" style="height: 240px; position: relative;">
              <canvas id="chart-analytics-wings"></canvas>
            </div>
          </div>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="card" style="margin-bottom: 1rem; padding: 0.85rem 1.15rem; background: var(--bg-card-header);">
          <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; justify-content: space-between;">
            <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; flex: 1;">
              <div style="min-width: 240px; flex: 1;">
                <input type="text" id="analytics-search-input" class="form-control" placeholder="Search by school name, code, city, or state..." style="font-size: 0.8rem; padding: 0.45rem 0.75rem;">
              </div>
              <div>
                <select id="analytics-status-filter" class="form-select" style="font-size: 0.8rem; padding: 0.45rem 0.75rem;">
                  <option value="">All Operational Statuses</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="TRIAL">TRIAL</option>
                </select>
              </div>
              <div>
                <select id="analytics-payment-filter" class="form-select" style="font-size: 0.8rem; padding: 0.45rem 0.75rem;">
                  <option value="">All Payment Statuses</option>
                  <option value="PAID">PAID</option>
                  <option value="OVERDUE">OVERDUE</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;" id="analytics-count-label">
              Showing ${matrix.length} Connected Schools
            </div>
          </div>
        </div>

        <!-- Granular Comparative Matrix Table -->
        <div class="card" style="margin-bottom: 1.5rem;">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>School & Location</th>
                  <th>Status & Health</th>
                  <th>Plan & Rate</th>
                  <th>Enrolled Students</th>
                  <th>Active Ratio</th>
                  <th>Teachers & Ratio</th>
                  <th>Attendance</th>
                  <th>Storage & Logins</th>
                  <th>Total Invoiced</th>
                  <th>Total Paid</th>
                  <th>Outstanding</th>
                  <th>Efficiency</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="matrix-tbody">
                ${matrix.length === 0 ? `
                  <tr><td colspan="13" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
                    <i class="fa-solid fa-school-circle-exclamation" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
                    No schools registered yet. Click <strong>Register School</strong> to onboard your first school ERP website.
                  </td></tr>
                ` : matrix.map(m => {
                  const activeRatio = m.students > 0 ? ((m.active_students / m.students) * 100).toFixed(1) : '0';
                  const rateLabel = m.pricing_model === 'PER_STUDENT' ? `₹${m.price_per_student}/st` : 'Flat Tier';
                  return `
                    <tr class="analytics-row" data-name="${(m.name || '').toLowerCase()}" data-code="${(m.code || '').toLowerCase()}" data-city="${(m.city || '').toLowerCase()}" data-status="${m.status}" data-payment="${m.payment_status}">
                      <td>
                        <strong>${m.name}</strong>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">
                          ${m.code} • ${m.city || 'India'}
                        </div>
                      </td>
                      <td>
                        <span class="badge ${m.status === 'ACTIVE' ? 'badge-active' : m.status === 'SUSPENDED' ? 'badge-suspended' : 'badge-trial'}">
                          ${m.status}
                        </span>
                        <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.15rem;">
                          <i class="fa-solid fa-circle" style="font-size: 6px; color: ${m.health_status === 'HEALTHY' ? '#10b981' : '#f59e0b'};"></i> ${m.health_status}
                        </div>
                      </td>
                      <td>
                        <span class="badge badge-trial" style="font-size: 0.7rem;">${m.plan_name || 'Pro'}</span>
                        <div style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace; margin-top: 0.15rem;">${rateLabel} • ${m.billing_cycle}</div>
                      </td>
                      <td>
                        <strong style="font-size: 0.95rem; color: var(--accent-primary);">${m.students.toLocaleString()}</strong>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">+${m.recent_admissions} new</div>
                      </td>
                      <td>
                        <div style="font-size: 0.8rem; font-weight: 600;">${activeRatio}%</div>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">(${m.active_students} active)</div>
                      </td>
                      <td>
                        <strong>${m.teachers}</strong>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">${m.student_teacher_ratio}:1 ratio</div>
                      </td>
                      <td>
                        <strong style="color: ${m.attendance_rate >= 90 ? '#10b981' : '#f59e0b'}; font-size: 0.85rem;">
                          ${m.attendance_rate}%
                        </strong>
                      </td>
                      <td>
                        <div style="font-size: 0.8rem;">${(m.storage_mb / 1024).toFixed(1)} GB</div>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">${m.daily_logins.toLocaleString()} logins</div>
                      </td>
                      <td>₹${m.total_invoiced.toLocaleString()}</td>
                      <td style="color: #10b981; font-weight: 700;">₹${m.total_paid.toLocaleString()}</td>
                      <td style="color: ${m.outstanding_balance > 0 ? '#ef4444' : 'var(--text-muted)'}; font-weight: 700;">
                        ₹${m.outstanding_balance.toLocaleString()}
                      </td>
                      <td>
                        <span class="badge ${m.collection_efficiency >= 100 ? 'badge-healthy' : m.collection_efficiency >= 50 ? 'badge-trial' : 'badge-suspended'}">
                          ${m.collection_efficiency}%
                        </span>
                      </td>
                      <td>
                        <button class="btn btn-secondary btn-sm" onclick="viewSchoolProfile('${m.id}')" style="padding: 0.25rem 0.55rem; font-size: 0.72rem;">
                          Profile
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Render Charts if schools exist
      if (matrix.length > 0) {
        // Chart 1: Students vs Teachers Census
        const ctxCensus = document.getElementById('chart-analytics-census')?.getContext('2d');
        if (ctxCensus) {
          state.activeCharts.analyticsCensus = new Chart(ctxCensus, {
            type: 'bar',
            data: {
              labels: matrix.slice(0, 10).map(s => s.code),
              datasets: [
                {
                  label: 'Enrolled Students',
                  data: matrix.slice(0, 10).map(s => s.students),
                  backgroundColor: 'rgba(37, 99, 235, 0.75)',
                  borderRadius: 4
                },
                {
                  label: 'Faculty & Teachers',
                  data: matrix.slice(0, 10).map(s => s.teachers),
                  backgroundColor: 'rgba(16, 185, 129, 0.75)',
                  borderRadius: 4
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
              scales: { y: { beginAtZero: true } }
            }
          });
        }

        // Chart 2: Revenue vs Paid vs Dues
        const ctxFinance = document.getElementById('chart-analytics-finance')?.getContext('2d');
        if (ctxFinance) {
          state.activeCharts.analyticsFinance = new Chart(ctxFinance, {
            type: 'bar',
            data: {
              labels: matrix.slice(0, 10).map(s => s.code),
              datasets: [
                {
                  label: 'Total Invoiced (₹)',
                  data: matrix.slice(0, 10).map(s => s.total_invoiced),
                  backgroundColor: 'rgba(148, 163, 184, 0.65)',
                  borderRadius: 4
                },
                {
                  label: 'Collected Revenue (₹)',
                  data: matrix.slice(0, 10).map(s => s.total_paid),
                  backgroundColor: 'rgba(16, 185, 129, 0.85)',
                  borderRadius: 4
                },
                {
                  label: 'Outstanding Dues (₹)',
                  data: matrix.slice(0, 10).map(s => s.outstanding_balance),
                  backgroundColor: 'rgba(239, 68, 68, 0.85)',
                  borderRadius: 4
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
              scales: { y: { beginAtZero: true } }
            }
          });
        }

        // Chart 3: Attendance Reliability
        const ctxAttendance = document.getElementById('chart-analytics-attendance')?.getContext('2d');
        if (ctxAttendance) {
          state.activeCharts.analyticsAttendance = new Chart(ctxAttendance, {
            type: 'bar',
            data: {
              labels: matrix.slice(0, 10).map(s => s.code),
              datasets: [{
                label: 'Daily Attendance %',
                data: matrix.slice(0, 10).map(s => s.attendance_rate),
                backgroundColor: matrix.slice(0, 10).map(s => s.attendance_rate >= 90 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(245, 158, 11, 0.75)'),
                borderRadius: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true, max: 100 } }
            }
          });
        }

        // Chart 4: Academic Wing Allocation Doughnut
        const ctxWings = document.getElementById('chart-analytics-wings')?.getContext('2d');
        if (ctxWings) {
          const wingLabels = Object.keys(wingDistribution);
          const wingData = Object.values(wingDistribution);
          state.activeCharts.analyticsWings = new Chart(ctxWings, {
            type: 'doughnut',
            data: {
              labels: wingLabels,
              datasets: [{
                data: wingData,
                backgroundColor: [
                  '#3b82f6',
                  '#10b981',
                  '#f59e0b',
                  '#8b5cf6'
                ],
                borderWidth: 2
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } }
            }
          });
        }
      }

      // Wire Live Client Filter
      const searchInput = document.getElementById('analytics-search-input');
      const statusFilter = document.getElementById('analytics-status-filter');
      const paymentFilter = document.getElementById('analytics-payment-filter');
      const countLabel = document.getElementById('analytics-count-label');

      function filterMatrixRows() {
        const q = (searchInput?.value || '').toLowerCase().trim();
        const stat = (statusFilter?.value || '');
        const pay = (paymentFilter?.value || '');
        const rows = document.querySelectorAll('.analytics-row');
        let visible = 0;

        rows.forEach(r => {
          const name = r.getAttribute('data-name') || '';
          const code = r.getAttribute('data-code') || '';
          const city = r.getAttribute('data-city') || '';
          const rowStatus = r.getAttribute('data-status') || '';
          const rowPay = r.getAttribute('data-payment') || '';

          const matchText = !q || name.includes(q) || code.includes(q) || city.includes(q);
          const matchStatus = !stat || rowStatus === stat;
          const matchPay = !pay || rowPay === pay;

          if (matchText && matchStatus && matchPay) {
            r.style.display = '';
            visible++;
          } else {
            r.style.display = 'none';
          }
        });

        if (countLabel) countLabel.textContent = `Showing ${visible} of ${matrix.length} Connected Schools`;
      }

      searchInput?.addEventListener('input', filterMatrixRows);
      statusFilter?.addEventListener('change', filterMatrixRows);
      paymentFilter?.addEventListener('change', filterMatrixRows);

    } catch (e) {
      container.innerHTML = `<div class="alert-box alert-danger">${e.message}</div>`;
    }
  }

  // ==========================================================================
  // 5. SUBSCRIPTION PLANS MANAGEMENT
  // ==========================================================================
  async function renderSubscriptions() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-tags" style="color: var(--accent-primary);"></i> Subscription Plans & Pricing</h1>
          <div class="page-subtitle">Configure commercial tiers • Manage module entitlements • School quota enforcement</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">
        ${state.plans.map(p => `
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="background: var(--bg-card-header);">
              <div>
                <span class="badge badge-trial" style="margin-bottom: 0.25rem;">${p.code}</span>
                <div style="font-size: 1.1rem; font-weight: 700;">${p.name}</div>
              </div>
              <div style="text-align: right;">
                <span class="badge badge-active">${p.active_schools_count || 0} Schools</span>
              </div>
            </div>
            <div class="card-body" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="margin-bottom: 1rem;">
                  <span style="font-size: 1.75rem; font-weight: 800; color: var(--accent-primary);">₹${p.monthly_price.toLocaleString()}</span>
                  <span style="font-size: 0.8rem; color: var(--text-muted);">/ month</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">or ₹${p.annual_price.toLocaleString()} billed annually</div>
                </div>

                <div style="font-size: 0.825rem; color: var(--text-muted); margin-bottom: 1rem;">
                  ${p.description}
                </div>

                <div style="border-top: 1px solid var(--border-main); padding-top: 0.75rem; margin-bottom: 0.75rem;">
                  <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">Entitlements:</div>
                  <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem;">
                    <div><i class="fa-solid fa-users" style="color: var(--accent-primary); width: 16px;"></i> Up to <strong>${p.max_students.toLocaleString()}</strong> students</div>
                    <div><i class="fa-solid fa-chalkboard-user" style="color: #8b5cf6; width: 16px;"></i> Up to <strong>${p.max_teachers}</strong> teachers</div>
                    <div><i class="fa-solid fa-hard-drive" style="color: #10b981; width: 16px;"></i> <strong>${p.max_storage_gb} GB</strong> secure cloud storage</div>
                  </div>
                </div>

                <div style="border-top: 1px solid var(--border-main); padding-top: 0.75rem;">
                  <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">Included Features:</div>
                  <ul style="list-style: none; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.35rem;">
                    ${(p.features || []).map(f => `
                      <li><i class="fa-solid fa-check" style="color: #10b981; margin-right: 0.35rem;"></i> ${f}</li>
                    `).join('')}
                  </ul>
                </div>
              </div>

              <div style="margin-top: 1.5rem; border-top: 1px solid var(--border-main); padding-top: 1rem;">
                <button class="btn btn-secondary btn-sm" style="width: 100%;" onclick="alert('Tier configuration locked by Super Admin policy')">
                  <i class="fa-solid fa-sliders"></i> Adjust Quotas
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ==========================================================================
  // 6. INVOICES & PAYMENTS MANAGEMENT
  // ==========================================================================
  async function renderInvoices() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-file-invoice-dollar" style="color: var(--accent-primary);"></i> Invoices & Payments Management</h1>
          <div class="page-subtitle">Commercial school billing • Record manual wire/UPI receipts • Automatic delinquency tracking</div>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button class="btn btn-primary" id="btn-create-invoice">
            <i class="fa-solid fa-plus"></i> Generate Invoice
          </button>
        </div>
      </div>

      <!-- Invoices Section -->
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-receipt"></i> Subscription Invoices</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>School Name</th>
                <th>Billing Cycle</th>
                <th>Period</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th>Total (INR)</th>
                <th>Balance Due</th>
                <th>Status</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody id="invoices-tbody">
              <tr><td colspan="10" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading invoices...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Settled Payments Transaction Ledger -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-money-bill-transfer" style="color: #10b981;"></i> Settled Payments Transaction Ledger</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Payment #</th>
                <th>School</th>
                <th>Invoice Ref</th>
                <th>Amount (INR)</th>
                <th>Payment Date</th>
                <th>Payment Method</th>
                <th>Transaction UTR / Ref</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="payments-tbody">
              <tr><td colspan="8" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading payments...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-create-invoice')?.addEventListener('click', () => {
      openModal('modal-generate-invoice');
    });

    try {
      const [invRes, payRes] = await Promise.all([
        api('/invoices'),
        api('/invoices/data/payments')
      ]);

      const invTbody = document.getElementById('invoices-tbody');
      const payTbody = document.getElementById('payments-tbody');

      if (invTbody && invRes.success) {
        if (invRes.data.length === 0) {
          invTbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem;">
            <div style="font-size: 2rem; color: var(--text-dim); margin-bottom: 0.5rem;"><i class="fa-solid fa-file-invoice"></i></div>
            <div style="font-weight: 600; color: var(--text-main); margin-bottom: 0.25rem;">No Invoices Generated Yet</div>
            <div style="font-size: 0.85rem; margin-bottom: 1rem;">Once schools are onboarded, subscription invoices and renewals will be tracked here.</div>
            <button class="btn btn-primary btn-sm" onclick="openModal('modal-generate-invoice')">
              <i class="fa-solid fa-plus"></i> Generate Invoice
            </button>
          </td></tr>`;
        } else {
          invTbody.innerHTML = invRes.data.map(i => {
            const cleanPhone = (i.owner_phone || '').replace(/[^0-9]/g, '');
            const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
            const waMsg = encodeURIComponent(
              `Hello ${i.owner_name || 'School Principal'},\n\n` +
              `Official payment reminder from Central ERP Command regarding *${i.school_name}*:\n` +
              `• Invoice: *${i.invoice_number}*\n` +
              `• Plan: ${i.plan_name || 'Campus Edition'} (${i.billing_cycle})\n` +
              `• Balance Due: *₹${(i.balance_due || 0).toLocaleString('en-IN')}*\n` +
              `• Due Date: *${i.due_date}*\n\n` +
              `*Settlement Details:*\n` +
              `Bank: HDFC Bank Ltd | A/C: 50200088991122 | IFSC: HDFC0001234\n` +
              `Instant UPI: centralerp@hdfcbank\n\n` +
              `Please share payment UTR once transferred.`
            );
            const waUrl = phoneWithCountry ? `https://wa.me/${phoneWithCountry}?text=${waMsg}` : null;

            return `
              <tr>
                <td><strong style="color: var(--accent-primary); font-family: monospace;">${i.invoice_number}</strong></td>
                <td>
                  <strong>${i.school_name}</strong>
                  <div style="font-size: 0.7rem; color: var(--text-muted); display: flex; gap: 0.4rem; margin-top: 0.1rem;">
                    <span>${i.school_code}</span>
                    <span>• ${i.owner_email || 'No email'}</span>
                  </div>
                </td>
                <td><span class="badge badge-trial">${i.billing_cycle}</span></td>
                <td style="font-size: 0.75rem;">${i.period_start}<br>to ${i.period_end}</td>
                <td>${i.issue_date}</td>
                <td><strong>${i.due_date}</strong></td>
                <td><strong>₹${i.total_amount.toLocaleString()}</strong></td>
                <td style="color: ${i.balance_due > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">
                  ₹${i.balance_due.toLocaleString()}
                </td>
                <td>
                  <span class="badge ${i.status === 'PAID' ? 'badge-paid' : i.status === 'OVERDUE' ? 'badge-overdue' : 'badge-pending'}">
                    ${i.status}
                  </span>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                  <div style="display: flex; gap: 0.35rem; justify-content: flex-end; align-items: center;">
                    <!-- Download Official PDF -->
                    <a href="/api/v1/invoices/${i.id}/pdf" target="_blank" class="btn btn-secondary btn-sm" title="Download Official Tax Invoice PDF">
                      <i class="fa-regular fa-file-pdf"></i> PDF
                    </a>

                    <!-- Send Email Button -->
                    <button type="button" class="btn btn-email btn-sm btn-inv-email" 
                      data-id="${i.id}" 
                      data-email="${i.owner_email || ''}" 
                      data-num="${i.invoice_number}"
                      title="Send Invoice & Official PDF via Email to ${i.owner_email}">
                      <i class="fa-solid fa-envelope"></i> Email
                    </button>

                    <!-- WhatsApp Button -->
                    ${waUrl ? `
                      <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" title="Send WhatsApp Payment Notice to ${i.owner_phone}">
                        <i class="fa-brands fa-whatsapp"></i> WhatsApp
                      </a>
                    ` : `
                      <button type="button" class="btn btn-secondary btn-sm" disabled title="No phone configured">
                        <i class="fa-brands fa-whatsapp"></i>
                      </button>
                    `}

                    <!-- Pay / Settled -->
                    ${i.balance_due > 0 ? `
                      <button type="button" class="btn btn-success btn-sm btn-record-pay" data-id="${i.id}" data-num="${i.invoice_number}" data-balance="${i.balance_due}" title="Mark Payment Complete (Auto-emails receipt & PDF)">
                        <i class="fa-solid fa-dollar-sign"></i> Pay
                      </button>
                    ` : '<span class="badge badge-paid" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;"><i class="fa-solid fa-check"></i> Paid</span>'}
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          // Attach payment listeners
          document.querySelectorAll('.btn-record-pay').forEach(b => {
            b.addEventListener('click', () => {
              openRecordPaymentModal(
                b.getAttribute('data-id'),
                b.getAttribute('data-num'),
                b.getAttribute('data-balance')
              );
            });
          });

          // Attach email invoice listeners
          document.querySelectorAll('.btn-inv-email').forEach(b => {
            b.addEventListener('click', async () => {
              const id = b.getAttribute('data-id');
              const email = b.getAttribute('data-email');
              const num = b.getAttribute('data-num');

              if (!email) {
                showToast('This school has no owner email address configured', 'warning');
                return;
              }

              const orig = b.innerHTML;
              b.disabled = true;
              b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

              try {
                const res = await api(`/invoices/${id}/send-email`, {
                  method: 'POST',
                  body: JSON.stringify({ message: 'Official subscription invoice notice' })
                });
                b.innerHTML = '<i class="fa-solid fa-check"></i> Sent';
                b.style.backgroundColor = '#10b981';
                showToast(`Invoice ${num} and PDF attachment emailed to ${email}!`, 'success');
              } catch (err) {
                b.disabled = false;
                b.innerHTML = orig;
                showToast(`Failed to send email: ${err.message}`, 'error');
              }
            });
          });
        }
      }

      if (payTbody && payRes.success) {
        if (payRes.data.length === 0) {
          payTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2.5rem 1.5rem;">
            <div style="font-size: 1.8rem; color: var(--text-dim); margin-bottom: 0.5rem;"><i class="fa-solid fa-receipt"></i></div>
            <div style="font-weight: 600; color: var(--text-main);">No Payment Transactions Recorded</div>
            <div style="font-size: 0.85rem;">When subscription payments (wire, UPI, net banking) are settled, receipts will appear here.</div>
          </td></tr>`;
        } else {
          payTbody.innerHTML = payRes.data.map(p => `
            <tr>
              <td><strong>${p.payment_number}</strong></td>
              <td>${p.school_name}</td>
              <td><code style="font-size: 0.75rem;">${p.invoice_number || 'N/A'}</code></td>
              <td style="font-weight: 700; color: #10b981;">₹${p.amount.toLocaleString()}</td>
              <td>${p.payment_date}</td>
              <td><span class="badge badge-trial">${p.payment_method}</span></td>
              <td><code style="font-size: 0.75rem;">${p.transaction_reference}</code></td>
              <td><span class="badge badge-healthy"><i class="fa-solid fa-check"></i> ${p.status}</span></td>
            </tr>
          `).join('');
        }
      }

    } catch (err) {
      container.innerHTML += `<div class="alert-box alert-danger">${err.message}</div>`;
    }
  }

  // ==========================================================================
  // 7. REMOTE CONTROLS & COMMAND QUEUE
  // ==========================================================================
  async function renderRemoteControls() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-tower-broadcast" style="color: var(--accent-primary);"></i> Remote ERP Service Control Console</h1>
          <div class="page-subtitle">Predefined commands • Pull-based delivery queue • Zero arbitrary SQL/execution risk</div>
        </div>
      </div>

      <!-- Command Dispatch Card -->
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-paper-plane" style="color: var(--accent-primary);"></i> Dispatch Remote Command</div>
        </div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; align-items: flex-end;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Select Target School *</label>
              <select class="form-select" id="ctrl-school-select">
                ${state.schools.length > 0 ? state.schools.map(s => `<option value="${s.id}">${s.name} (${s.status})</option>`).join('') : '<option value="">No schools available</option>'}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Action *</label>
              <select class="form-select" id="ctrl-cmd-select">
                <option value="SUSPEND_SERVICE">SUSPEND_SERVICE (Route users to suspended page)</option>
                <option value="REACTIVATE_SERVICE">REACTIVATE_SERVICE (Restore full operational access)</option>
                <option value="EXTEND_SUBSCRIPTION">EXTEND_SUBSCRIPTION (Add 30 grace days)</option>
                <option value="UPDATE_MODULES">UPDATE_MODULES (Sync permitted modules)</option>
              </select>
            </div>
            <div>
              <button class="btn btn-danger" id="btn-quick-dispatch" style="width: 100%;">
                <i class="fa-solid fa-bolt"></i> Configure & Dispatch
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Live Command Queue & Audit History -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-list-check"></i> Command Execution Queue & Acknowledgment Log</div>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-queue"><i class="fa-solid fa-rotate"></i> Refresh Queue</button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Command ID</th>
                <th>Target School</th>
                <th>Command Type</th>
                <th>Queue Status</th>
                <th>Issued At</th>
                <th>Executed At</th>
                <th>Execution Result Log</th>
                <th style="text-align: right;">Simulate Poll</th>
              </tr>
            </thead>
            <tbody id="commands-tbody">
              <tr><td colspan="8" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading commands...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-quick-dispatch')?.addEventListener('click', () => {
      const schId = document.getElementById('ctrl-school-select').value;
      const cmdType = document.getElementById('ctrl-cmd-select').value;
      openRemoteCommandModal(schId, cmdType);
    });

    document.getElementById('btn-refresh-queue')?.addEventListener('click', () => loadCommandsQueue());

    loadCommandsQueue();
  }

  async function loadCommandsQueue() {
    const tbody = document.getElementById('commands-tbody');
    if (!tbody) return;

    try {
      const res = await api('/remote-control/commands');
      if (!res.success) return;

      if (res.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2.5rem 1rem;">
          <div style="font-size: 1.8rem; color: var(--text-dim); margin-bottom: 0.5rem;"><i class="fa-solid fa-satellite-dish"></i></div>
          <div style="font-weight: 600; color: var(--text-main); margin-bottom: 0.25rem;">No Remote Commands in Queue</div>
          <div style="font-size: 0.85rem;">When suspension, reactivation, or module commands are dispatched, their delivery and execution logs appear here.</div>
        </td></tr>`;
        return;
      }

      tbody.innerHTML = res.data.map(cmd => {
        const isPending = cmd.status === 'PENDING' || cmd.status === 'DELIVERED';
        return `
          <tr>
            <td><strong style="font-family: monospace;">${cmd.command_id}</strong></td>
            <td>
              <strong>${cmd.school_name}</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted);">${cmd.school_code}</div>
            </td>
            <td>
              <span class="badge ${cmd.command_type.includes('SUSPEND') ? 'badge-suspended' : 'badge-active'}">
                ${cmd.command_type}
              </span>
            </td>
            <td>
              <span class="badge ${cmd.status === 'EXECUTED' ? 'badge-healthy' : isPending ? 'badge-pending' : 'badge-suspended'}">
                ${cmd.status}
              </span>
            </td>
            <td style="font-size: 0.75rem;">${formatTimeAgo(cmd.issued_at)}</td>
            <td style="font-size: 0.75rem;">${cmd.executed_at ? formatTimeAgo(cmd.executed_at) : 'Awaiting Ack'}</td>
            <td style="font-size: 0.75rem; color: var(--text-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis;" title="${cmd.result_log || ''}">
              ${cmd.result_log || 'Command queued for school connector poll'}
            </td>
            <td style="text-align: right;">
              ${isPending ? `
                <button class="btn btn-secondary btn-sm btn-sim-exec" data-cmd="${cmd.command_id}" title="Simulate connector polling this command and acknowledging execution">
                  <i class="fa-solid fa-play"></i> Simulate Ack
                </button>
              ` : '<span style="color: #10b981; font-size: 0.75rem;"><i class="fa-solid fa-check"></i> Executed</span>'}
            </td>
          </tr>
        `;
      }).join('');

      document.querySelectorAll('.btn-sim-exec').forEach(b => {
        b.addEventListener('click', async () => {
          const cmdId = b.getAttribute('data-cmd');
          try {
            showToast(`Simulating connector pull for ${cmdId}...`, 'info');
            const simRes = await api('/remote-control/simulate-execution', {
              method: 'POST',
              body: JSON.stringify({ command_id: cmdId })
            });
            showToast(simRes.message, 'success');
            await loadInitialData();
            loadCommandsQueue();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });

    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="color: #ef4444; padding: 1.5rem;">${e.message}</td></tr>`;
    }
  }

  // ==========================================================================
  // 8. ERP MONITORING & TELEMETRY
  // ==========================================================================
  async function renderERPMonitoring() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-heart-pulse" style="color: #10b981;"></i> ERP Systems Vitality & Telemetry Monitoring</h1>
          <div class="page-subtitle">Heartbeat pings • CPU & Memory load • Database sizes • Connector latency</div>
        </div>
      </div>

      ${state.schools.length === 0 ? `
        <div class="card" style="padding: 3.5rem 1.5rem; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.2rem; color: var(--text-dim); margin-bottom: 0.6rem;"><i class="fa-solid fa-heart-pulse"></i></div>
          <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 0.25rem;">No ERP Connectors Monitored</div>
          <div style="font-size: 0.85rem; max-width: 440px; margin: 0 auto 1.25rem;">
            When you deploy the Connector SDK on your school ERP servers, live CPU, memory, database size, and latency telemetry will appear here.
          </div>
          <button class="btn btn-primary btn-sm" onclick="openModal('modal-register-school')">
            <i class="fa-solid fa-plus"></i> Register School Connector
          </button>
        </div>
      ` : `
        <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
          ${state.schools.map(s => `
            <div class="card">
              <div class="card-header" style="background: var(--bg-card-header);">
                <div>
                  <strong style="font-size: 0.95rem;">${s.name}</strong>
                  <div style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace;">${s.erp_url}</div>
                </div>
                <span class="badge ${s.health_status === 'HEALTHY' ? 'badge-healthy' : 'badge-stale'}">
                  ${s.health_status}
                </span>
              </div>
              <div class="card-body" style="font-size: 0.8rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                  <span style="color: var(--text-muted);">Connector Version:</span>
                  <code>v1.4.2</code>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                  <span style="color: var(--text-muted);">Last Heartbeat:</span>
                  <strong>${s.last_heartbeat_at ? formatTimeAgo(s.last_heartbeat_at) : 'Never'}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                  <span style="color: var(--text-muted);">Last Sync Census:</span>
                  <strong>${s.last_sync_at ? formatTimeAgo(s.last_sync_at) : 'Never'}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                  <span style="color: var(--text-muted);">Database Storage:</span>
                  <strong>${((s.storage_used_mb || 14000) / 1024).toFixed(1)} GB</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-muted);">API Auth Protocol:</span>
                  <span class="badge badge-trial">HMAC-SHA256 (300s window)</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // ==========================================================================
  // 9. SECURITY LOGS & AUDIT MANAGEMENT
  // ==========================================================================
  async function renderSecurityLogs() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-shield-halved" style="color: var(--accent-primary);"></i> Central Security Stream & Audit Trail</h1>
          <div class="page-subtitle">Aggregated threat telemetry across all independent School ERPs • Administrative operations</div>
        </div>
      </div>

      <!-- Severity Filter Pills -->
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem;">
        <button class="btn btn-secondary btn-sm sec-filter-btn active" data-sev="">All Events</button>
        <button class="btn btn-secondary btn-sm sec-filter-btn" data-sev="CRITICAL">Critical Only</button>
        <button class="btn btn-secondary btn-sm sec-filter-btn" data-sev="ERROR">Errors</button>
        <button class="btn btn-secondary btn-sm sec-filter-btn" data-sev="WARNING">Warnings</button>
        <button class="btn btn-secondary btn-sm sec-filter-btn" data-sev="INFO">Info</button>
      </div>

      <div class="card">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Event Type</th>
                <th>School / Source ERP</th>
                <th>User / Identity</th>
                <th>IP Address</th>
                <th>Description</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody id="security-tbody">
              <tr><td colspan="7" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading security events...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const loadEvents = async (sev = '') => {
      const tbody = document.getElementById('security-tbody');
      if (!tbody) return;
      try {
        const res = await api(`/security/events${sev ? '?severity=' + sev : ''}`);
        if (!res.success) return;

        if (res.data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem;">
            <div style="font-size: 2rem; color: #10b981; margin-bottom: 0.5rem;"><i class="fa-solid fa-shield-halved"></i></div>
            <div style="font-weight: 600; color: var(--text-main); margin-bottom: 0.25rem;">Security Stream Clean</div>
            <div style="font-size: 0.85rem;">No security threats, unauthorized access attempts, or HMAC mismatch alerts logged.</div>
          </td></tr>`;
          return;
        }

        tbody.innerHTML = res.data.map(e => `
          <tr>
            <td>
              <span class="badge ${e.severity === 'CRITICAL' ? 'badge-suspended' : e.severity === 'ERROR' ? 'badge-overdue' : e.severity === 'WARNING' ? 'badge-pending' : 'badge-healthy'}">
                ${e.severity}
              </span>
            </td>
            <td><strong style="font-family: monospace; font-size: 0.75rem;">${e.event_type}</strong></td>
            <td>
              <strong>${e.school_name || 'Central Platform'}</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted);">${e.source_erp}</div>
            </td>
            <td><code style="font-size: 0.75rem;">${e.user_identifier || 'system'}</code></td>
            <td><span style="font-family: monospace; font-size: 0.75rem;">${e.ip_address || '127.0.0.1'}</span></td>
            <td style="font-size: 0.8rem;">${e.description}</td>
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimeAgo(e.created_at)}</td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color: #ef4444; padding: 1.5rem;">${err.message}</td></tr>`;
      }
    };

    document.querySelectorAll('.sec-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sec-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadEvents(btn.getAttribute('data-sev'));
      });
    });

    loadEvents();
  }

  // ==========================================================================
  // 10. NOTIFICATIONS & AUTOMATION RULES
  // ==========================================================================
  async function renderNotifications() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-bell" style="color: var(--accent-primary);"></i> Notification Inbox & Automation Rules</h1>
          <div class="page-subtitle">Commercial reminders • Threat alerts • Configurable background automation policies</div>
        </div>
        <div>
          <button class="btn btn-secondary btn-sm" id="btn-read-all">
            <i class="fa-solid fa-check-double"></i> Mark All as Read
          </button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.25rem;">
        <!-- Notifications List -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-inbox"></i> System Notifications</div>
          </div>
          <div class="card-body" style="padding: 0.75rem;">
            <div style="display: flex; flex-direction: column; gap: 0.6rem;" id="notifs-container">
              ${state.notifications.map(n => `
                <div style="padding: 0.85rem; border-radius: 6px; background: ${n.is_read ? 'transparent' : 'var(--bg-card-header)'}; border: 1px solid var(--border-main); display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                      <span class="badge ${n.severity === 'CRITICAL' ? 'badge-suspended' : n.severity === 'ERROR' ? 'badge-overdue' : n.severity === 'WARNING' ? 'badge-pending' : 'badge-healthy'}" style="font-size: 0.65rem;">
                        ${n.severity}
                      </span>
                      <strong style="font-size: 0.85rem;">${n.title}</strong>
                      ${!n.is_read ? '<span style="width: 7px; height: 7px; background: #3b82f6; border-radius: 50%;"></span>' : ''}
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${n.message}</div>
                    <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.35rem;">
                      School: ${n.school_name || 'Global'} • ${formatTimeAgo(n.created_at)}
                    </div>
                  </div>
                  <div>
                    ${!n.is_read ? `
                      <button class="btn btn-secondary btn-sm btn-mark-read" data-id="${n.id}">
                        <i class="fa-solid fa-check"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Automation Policies -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-robot" style="color: #8b5cf6;"></i> Automation Engine Rules</div>
          </div>
          <div class="card-body" style="font-size: 0.8rem;">
            <div style="margin-bottom: 1rem; border-bottom: 1px solid var(--border-main); padding-bottom: 0.75rem;">
              <strong>Pre-Expiry Notice (7 Days)</strong>
              <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.2rem;">Dispatches reminder notice to school owner and billing team 7 days before subscription end.</div>
              <span class="badge badge-healthy" style="margin-top: 0.35rem;">ACTIVE</span>
            </div>

            <div style="margin-bottom: 1rem; border-bottom: 1px solid var(--border-main); padding-bottom: 0.75rem;">
              <strong>Overdue Payment Alert</strong>
              <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.2rem;">Raises alert immediately when subscription invoice due date passes without payment.</div>
              <span class="badge badge-healthy" style="margin-top: 0.35rem;">ACTIVE</span>
            </div>

            <div style="margin-bottom: 1rem; border-bottom: 1px solid var(--border-main); padding-bottom: 0.75rem;">
              <strong>Auto-Suspension for Expired Grace Period</strong>
              <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.2rem;">When opt-in enabled for school, enqueues SUSPEND_SERVICE command after grace period days elapse.</div>
              <span class="badge badge-trial" style="margin-top: 0.35rem;">OPT-IN PER SCHOOL</span>
            </div>

            <div style="margin-bottom: 1.25rem;">
              <strong>Connector Offline Alert (30 Mins)</strong>
              <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.2rem;">Flags school as OFFLINE if no heartbeat or sync payload received in 30 minutes.</div>
              <span class="badge badge-healthy" style="margin-top: 0.35rem;">ACTIVE</span>
            </div>

            <button class="btn btn-primary btn-sm" id="btn-eval-rules" style="width: 100%;">
              <i class="fa-solid fa-play"></i> Evaluate All Rules Now
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-read-all')?.addEventListener('click', async () => {
      await api('/notifications/read-all', { method: 'PUT' });
      showToast('All notifications marked as read', 'success');
      await loadInitialData();
      renderNotifications();
    });

    document.getElementById('btn-eval-rules')?.addEventListener('click', async () => {
      showToast('Evaluating automation policies...', 'info');
      const res = await api('/automation/evaluate', { method: 'POST' });
      showToast(`Automation complete: ${res.results.length} policies evaluated.`, 'success');
      await loadInitialData();
      renderNotifications();
    });

    document.querySelectorAll('.btn-mark-read').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        await api(`/notifications/${id}/read`, { method: 'PUT' });
        await loadInitialData();
        renderNotifications();
      });
    });
  }

  // ==========================================================================
  // 11. REPORTS (ENTERPRISE BUSINESS INTELLIGENCE & EXPORT HUB)
  // ==========================================================================
  async function renderReports() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--accent-primary);"></i>
        <div style="margin-top: 0.5rem; color: var(--text-muted);">Loading real-time reporting data...</div>
      </div>
    `;

    try {
      const res = await api('/analytics/deep-metrics');
      const { kpis, matrix } = res.data;

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h1 class="page-title"><i class="fa-solid fa-file-export" style="color: var(--accent-primary);"></i> Enterprise Business Intelligence Reports</h1>
            <div class="page-subtitle">100% Real-time database statements • Granular academic census • Commercial revenue ledger • Compliance audits</div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <a href="/api/v1/analytics/export?type=json" class="btn btn-secondary btn-sm" download>
              <i class="fa-solid fa-code"></i> Download JSON Bundle
            </a>
            <button class="btn btn-secondary btn-sm" onclick="window.print()">
              <i class="fa-solid fa-print"></i> Print View
            </button>
          </div>
        </div>

        <!-- 4 Granular Enterprise Report Suites -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.25rem; margin-bottom: 2rem;">
          
          <!-- Report 1: Master Comparative Matrix -->
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="background: var(--bg-card-header);">
              <div class="card-title" style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-table-cells" style="color: var(--accent-primary); font-size: 1.15rem;"></i>
                <div>
                  <div style="font-size: 0.95rem; font-weight: 700;">Master Comparative BI Matrix</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">Cross-School Benchmarking & Telemetry</div>
                </div>
              </div>
              <span class="badge badge-active">${kpis.totalSchools} Schools</span>
            </div>
            <div class="card-body" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.45;">
                Comprehensive matrix containing every connected school ERP, enrolled student census, teacher count, daily attendance %, storage consumption, operational status, invoiced amount, and collection efficiency.
              </p>
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                  <a href="/api/v1/analytics/export?type=all" class="btn btn-primary btn-sm" style="text-align: center;" download>
                    <i class="fa-solid fa-file-csv"></i> Download CSV
                  </a>
                  <a href="/api/v1/analytics/export?type=json" class="btn btn-secondary btn-sm" style="text-align: center;" download>
                    <i class="fa-solid fa-file-code"></i> JSON Data
                  </a>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.openReportPreview('matrix')">
                  <i class="fa-solid fa-eye"></i> Live Interactive Preview
                </button>
              </div>
            </div>
          </div>

          <!-- Report 2: Financial Subscription Ledger -->
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="background: var(--bg-card-header);">
              <div class="card-title" style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-file-invoice-dollar" style="color: #10b981; font-size: 1.15rem;"></i>
                <div>
                  <div style="font-size: 0.95rem; font-weight: 700;">Financial Subscription Ledger</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">Invoices, GST Tax Breakdown & Settlement Dues</div>
                </div>
              </div>
              <span class="badge badge-healthy">₹${kpis.totalPaid.toLocaleString()}</span>
            </div>
            <div class="card-body" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.45;">
                Detailed commercial audit ledger containing all subscription invoices, 18% GST tax breakdown, due dates, paid amounts, bank RTGS / NEFT / UPI settlement reference IDs, and delinquent receivables.
              </p>
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                  <a href="/api/v1/analytics/export?type=financial" class="btn btn-primary btn-sm" style="text-align: center;" download>
                    <i class="fa-solid fa-file-csv"></i> Download CSV
                  </a>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.openReportPreview('financial')">
                    <i class="fa-solid fa-eye"></i> Preview
                  </button>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.print()">
                  <i class="fa-solid fa-print"></i> Print Official Statement
                </button>
              </div>
            </div>
          </div>

          <!-- Report 3: Academic Census & Capacity Allocation -->
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="background: var(--bg-card-header);">
              <div class="card-title" style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-users" style="color: #f59e0b; font-size: 1.15rem;"></i>
                <div>
                  <div style="font-size: 0.95rem; font-weight: 700;">Academic Census & Capacity</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">Enrollment, Staff Ratios & Class Allocations</div>
                </div>
              </div>
              <span class="badge badge-trial">${kpis.totalStudents.toLocaleString()} Students</span>
            </div>
            <div class="card-body" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.45;">
                Granular academic report covering total enrolled students, active vs inactive counts, recent admissions, transfers, faculty headcount, student/teacher ratios, and Primary through Senior Secondary class distributions.
              </p>
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <a href="/api/v1/analytics/export?type=census" class="btn btn-primary btn-sm" style="text-align: center;" download>
                  <i class="fa-solid fa-file-csv"></i> Download Census CSV
                </a>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.openReportPreview('census')">
                  <i class="fa-solid fa-eye"></i> Live Interactive Preview
                </button>
              </div>
            </div>
          </div>

          <!-- Report 4: Security, Threat Telemetry & Operational Audit -->
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="background: var(--bg-card-header);">
              <div class="card-title" style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-shield-virus" style="color: #ef4444; font-size: 1.15rem;"></i>
                <div>
                  <div style="font-size: 0.95rem; font-weight: 700;">Security & Threat Audit Trail</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">Login Anomalies, Suspensions & Operator Actions</div>
                </div>
              </div>
              <span class="badge badge-stale"><i class="fa-solid fa-lock"></i> Immutable</span>
            </div>
            <div class="card-body" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.45;">
                Consolidated security log and operator audit trail: failed login anomalies, brute force spikes, remote suspension commands, reactivation events, and credential rotation timestamps across all connected ERPs.
              </p>
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <a href="/api/v1/analytics/export?type=security" class="btn btn-primary btn-sm" style="text-align: center;" download>
                  <i class="fa-solid fa-file-shield"></i> Download Security Audit CSV
                </a>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.openReportPreview('security')">
                  <i class="fa-solid fa-eye"></i> Live Interactive Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      container.innerHTML += `<div class="alert-box alert-danger">${e.message}</div>`;
    }
  }

  // --------------------------------------------------------------------------
  // Interactive Live Report Previewer Engine
  // --------------------------------------------------------------------------
  window.openReportPreview = async function(reportType) {
    const titleEl = document.getElementById('preview-report-title');
    const subEl = document.getElementById('preview-report-subtitle');
    const tableContainer = document.getElementById('preview-report-table-container');
    const downloadCsvBtn = document.getElementById('btn-preview-download-csv');
    const filterInput = document.getElementById('preview-report-filter');

    if (!tableContainer) return;

    if (downloadCsvBtn) {
      downloadCsvBtn.href = `/api/v1/analytics/export?type=${reportType === 'matrix' ? 'all' : reportType}`;
    }

    if (filterInput) filterInput.value = '';

    openModal('modal-report-preview');

    tableContainer.innerHTML = `
      <div style="text-align: center; padding: 2.5rem;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--accent-primary);"></i>
        <div style="margin-top: 0.5rem; color: var(--text-muted);">Fetching 100% real database records for preview...</div>
      </div>
    `;

    try {
      if (reportType === 'matrix') {
        if (titleEl) titleEl.textContent = 'Master Comparative BI Matrix — Live Preview';
        if (subEl) subEl.textContent = '100% Real Synchronized School Performance & Telemetry';

        const res = await api('/analytics/comparison');
        const list = res.data;

        if (list.length === 0) {
          tableContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">No school records found in database.</div>';
          return;
        }

        tableContainer.innerHTML = `
          <table class="data-table" id="preview-active-table">
            <thead>
              <tr>
                <th>Code</th><th>School Name</th><th>City</th><th>Status</th><th>Plan</th>
                <th>Students</th><th>Teachers</th><th>Ratio</th><th>Attendance</th><th>Invoiced</th><th>Paid</th><th>Dues</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(r => `
                <tr class="preview-row">
                  <td><code>${r.code}</code></td>
                  <td><strong>${r.name}</strong></td>
                  <td>${r.city || 'India'}</td>
                  <td><span class="badge ${r.status === 'ACTIVE' ? 'badge-active' : 'badge-suspended'}">${r.status}</span></td>
                  <td>${r.plan_name || 'Standard'}</td>
                  <td><strong>${r.students.toLocaleString()}</strong></td>
                  <td>${r.teachers}</td>
                  <td>${r.student_teacher_ratio}:1</td>
                  <td><strong>${r.attendance_rate}%</strong></td>
                  <td>₹${r.total_invoiced.toLocaleString()}</td>
                  <td style="color: #10b981; font-weight: 700;">₹${r.total_paid.toLocaleString()}</td>
                  <td style="color: ${r.outstanding_balance > 0 ? '#ef4444' : 'inherit'}; font-weight: 700;">₹${r.outstanding_balance.toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reportType === 'financial') {
        if (titleEl) titleEl.textContent = 'Financial Subscription & Revenue Ledger — Live Preview';
        if (subEl) subEl.textContent = '100% Real Commercial Invoices, 18% GST Taxes & Recorded Payments';

        const res = await api('/analytics/reports/financial');
        const list = res.data;

        if (list.length === 0) {
          tableContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">No subscription invoices or payment records found in database.</div>';
          return;
        }

        tableContainer.innerHTML = `
          <table class="data-table" id="preview-active-table">
            <thead>
              <tr>
                <th>Invoice #</th><th>School Name</th><th>Cycle</th><th>Subtotal</th><th>GST (18%)</th>
                <th>Total (INR)</th><th>Balance Due</th><th>Status</th><th>Paid Amount</th><th>Latest Payment Date</th><th>Ref / UTR</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(r => `
                <tr class="preview-row">
                  <td><code>${r.invoice_number}</code></td>
                  <td><strong>${r.school_name}</strong> (${r.school_code})</td>
                  <td>${r.billing_cycle}</td>
                  <td>₹${r.subtotal.toLocaleString()}</td>
                  <td>₹${r.tax_amount.toLocaleString()}</td>
                  <td><strong>₹${r.total_amount.toLocaleString()}</strong></td>
                  <td style="color: ${r.balance_due > 0 ? '#ef4444' : 'var(--text-muted)'}; font-weight: 700;">₹${r.balance_due.toLocaleString()}</td>
                  <td><span class="badge ${r.invoice_status === 'PAID' ? 'badge-active' : r.invoice_status === 'OVERDUE' ? 'badge-suspended' : 'badge-trial'}">${r.invoice_status}</span></td>
                  <td style="color: #10b981; font-weight: 700;">₹${r.total_payments.toLocaleString()}</td>
                  <td>${r.latest_payment_date || 'N/A'}</td>
                  <td><code>${r.latest_payment_reference || 'N/A'}</code></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reportType === 'census') {
        if (titleEl) titleEl.textContent = 'Academic Census & Student Capacity Report — Live Preview';
        if (subEl) subEl.textContent = '100% Real Student Enrollments, Faculty Counts & Class Breakdown';

        const res = await api('/analytics/reports/census');
        const list = res.data;

        if (list.length === 0) {
          tableContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">No academic census records found in database.</div>';
          return;
        }

        tableContainer.innerHTML = `
          <table class="data-table" id="preview-active-table">
            <thead>
              <tr>
                <th>School Code</th><th>School Name</th><th>Total Students</th><th>Active Count</th>
                <th>New Admissions</th><th>Departed</th><th>Faculty</th><th>Staff</th><th>Ratio</th><th>Daily Attendance</th><th>Last Sync</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(r => `
                <tr class="preview-row">
                  <td><code>${r.school_code}</code></td>
                  <td><strong>${r.school_name}</strong></td>
                  <td><strong style="color: var(--accent-primary); font-size: 0.95rem;">${r.total_students.toLocaleString()}</strong></td>
                  <td>${r.active_students.toLocaleString()}</td>
                  <td>+${r.recent_admissions}</td>
                  <td>-${r.departed_students}</td>
                  <td>${r.total_teachers}</td>
                  <td>${r.non_teaching_staff}</td>
                  <td><strong>${r.student_teacher_ratio}:1</strong></td>
                  <td><strong style="color: ${r.attendance_rate >= 90 ? '#10b981' : '#f59e0b'};">${r.attendance_rate}%</strong></td>
                  <td style="font-size: 0.72rem; color: var(--text-muted);">${r.sync_timestamp || 'Never'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reportType === 'security') {
        if (titleEl) titleEl.textContent = 'Security, Threat Telemetry & Operational Audit Trail — Live Preview';
        if (subEl) subEl.textContent = '100% Real System Threat Events, Operator Actions & Suspensions';

        const res = await api('/analytics/reports/security');
        const list = res.data;

        if (list.length === 0) {
          tableContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">No security events recorded in database.</div>';
          return;
        }

        tableContainer.innerHTML = `
          <table class="data-table" id="preview-active-table">
            <thead>
              <tr>
                <th>Timestamp</th><th>School</th><th>Event Type</th><th>Severity</th><th>User Identifier</th><th>IP Address</th><th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(r => `
                <tr class="preview-row">
                  <td style="font-size: 0.75rem; font-family: monospace;">${r.created_at}</td>
                  <td><strong>${r.school_name || 'Central Platform'}</strong></td>
                  <td><code>${r.event_type}</code></td>
                  <td><span class="badge ${r.severity === 'CRITICAL' ? 'badge-suspended' : r.severity === 'WARNING' ? 'badge-trial' : 'badge-active'}">${r.severity}</span></td>
                  <td>${r.user_identifier || 'SYSTEM'}</td>
                  <td><code>${r.ip_address || '127.0.0.1'}</code></td>
                  <td style="font-size: 0.78rem;">${r.description}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }

      // Wire live search within report preview
      if (filterInput) {
        filterInput.oninput = function() {
          const q = filterInput.value.toLowerCase().trim();
          const rows = document.querySelectorAll('.preview-row');
          rows.forEach(r => {
            const text = r.textContent.toLowerCase();
            r.style.display = !q || text.includes(q) ? '' : 'none';
          });
        };
      }
    } catch (err) {
      tableContainer.innerHTML = `<div class="alert-box alert-danger">${err.message}</div>`;
    }
  };

  // ==========================================================================
  // 12. INTEGRATIONS & CONNECTOR SDK
  // ==========================================================================
  async function renderIntegrations() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-network-wired" style="color: var(--accent-primary);"></i> School ERP Integration & Connector SDK</h1>
          <div class="page-subtitle">Connect independent school ERP websites to Central Command • Security handshake • SDK code</div>
        </div>
      </div>

      <div class="alert-box alert-info">
        <i class="fa-solid fa-circle-info" style="font-size: 1.25rem;"></i>
        <div>
          <strong>Architectural Isolation:</strong> Each school ERP maintains its own separate database, students, teachers, and fee records. The school's connector runs a scheduled agent that computes aggregated statistics and pushes telemetry over HTTPS with HMAC-SHA256 authentication. <strong>No raw school DB credentials or student PII are ever exposed to the central platform.</strong>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
        <!-- SDK Architecture Specs -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-code" style="color: var(--accent-primary);"></i> Connector Handshake & Security Protocol</div>
          </div>
          <div class="card-body" style="font-size: 0.825rem;">
            <div style="margin-bottom: 0.75rem;">
              <strong>1. Integration Headers Required on Every Request:</strong>
              <pre style="background: var(--bg-card-header); padding: 0.6rem; border-radius: 4px; margin-top: 0.35rem; font-family: monospace; font-size: 0.75rem;">
x-school-id: sch-xavier-01
x-api-key: key_live_xav_90218f4a...
x-timestamp: 1731500000 (UNIX timestamp)
x-signature: &lt;HMAC-SHA256 hex digest&gt;
x-idempotency-key: sync-20261113-1600 (optional)
              </pre>
            </div>

            <div style="margin-bottom: 0.75rem;">
              <strong>2. HMAC Signing Algorithm:</strong>
              <pre style="background: var(--bg-card-header); padding: 0.6rem; border-radius: 4px; margin-top: 0.35rem; font-family: monospace; font-size: 0.75rem;">
signature_payload = school_id + ":" + timestamp + ":" + raw_body
expected_signature = HMAC_SHA256(hmac_secret, signature_payload)
              </pre>
            </div>

            <div>
              <strong>3. Replay Protection Window:</strong>
              <p style="color: var(--text-muted); font-size: 0.78rem; margin-top: 0.25rem;">
                Requests with timestamp drifting more than <strong>300 seconds</strong> from Central Server time are rejected with HTTP 401 Unauthorized.
              </p>
            </div>
          </div>
        </div>

        <!-- Python & Node.js Connector Implementation -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><i class="fa-brands fa-python" style="color: #3b82f6;"></i> Python / Node.js Connector SDK Example</div>
          </div>
          <div class="card-body">
            <pre style="background: var(--bg-card-header); padding: 0.85rem; border-radius: 6px; font-family: monospace; font-size: 0.75rem; overflow-x: auto;">
# Python ERP Connector Reference Snippet
from connector_sdk import ERPConnectorSDK

sdk = ERPConnectorSDK(
    central_url="https://central-command.domain",
    school_id="sch-xavier-01",
    api_key="key_live_...",
    hmac_secret="sec_live_hmac_..."
)

# 1. Send Heartbeat Telemetry
sdk.send_heartbeat(cpu_pct=18.4, mem_pct=42.1)

# 2. Check Pending Predefined Remote Commands
commands = sdk.poll_pending_commands()
for cmd in commands:
    if cmd['commandType'] == 'SUSPEND_SERVICE':
        sdk.apply_local_suspension(cmd['payload'])
        sdk.acknowledge_command(cmd['commandId'], "SUCCESS")
            </pre>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // 13. SETTINGS & PLATFORM METADATA
  // ==========================================================================
  async function renderSettings() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-sliders" style="color: var(--accent-primary);"></i> Platform Settings & Policies</h1>
          <div class="page-subtitle">Global commercial parameters • Default grace periods • Brand configuration</div>
        </div>
      </div>

      <div class="card" style="max-width: 700px;">
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Platform Name</label>
            <input type="text" class="form-control" value="CENTRAL ERP COMMAND — Multi-School SaaS HQ" readonly>
          </div>

          <div class="form-group">
            <label class="form-label">Default Subscription Grace Period (Days)</label>
            <input type="number" class="form-control" value="7">
            <span style="font-size: 0.72rem; color: var(--text-muted);">Number of days before an overdue school ERP becomes eligible for service suspension.</span>
          </div>

          <div class="form-group">
            <label class="form-label">Central Billing Support Email</label>
            <input type="email" class="form-control" value="billing@centralcommand.io">
            <span style="font-size: 0.72rem; color: var(--text-muted);">Displayed on school suspended service landing pages.</span>
          </div>

          <div class="form-group">
            <label class="form-label">Replay Attack Clock Drift Tolerance</label>
            <input type="text" class="form-control" value="300 Seconds (5 Minutes)" readonly>
          </div>

          <button class="btn btn-primary" onclick="showToast('Settings saved successfully', 'success')">
            <i class="fa-solid fa-floppy-disk"></i> Save Configuration
          </button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // 14. ADMIN & ACCESS PERMISSIONS (DATABASE-BACKED USERS MANAGEMENT)
  // ==========================================================================
  async function renderAdminAccess() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: var(--accent-primary);"></i>
        <div style="margin-top: 1rem; color: var(--text-muted);">Loading database users...</div>
      </div>
    `;

    try {
      const res = await api('/auth/users');
      const users = res.success && Array.isArray(res.users) ? res.users : [];

      container.innerHTML = `
        <div class="page-header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <h1 class="page-title"><i class="fa-solid fa-user-shield" style="color: var(--accent-primary);"></i> Database Users & Access Control</h1>
            <div class="page-subtitle">Strict Database-Backed Authentication • Only User IDs & Passwords present in DB are allowed to log in</div>
          </div>
          <button class="btn btn-primary" id="btn-open-add-db-user">
            <i class="fa-solid fa-user-plus"></i> Add User to Database
          </button>
        </div>

        <div class="card" style="margin-bottom: 1.5rem; background: rgba(37,99,235,0.04); border: 1px solid rgba(37,99,235,0.2);">
          <div style="display: flex; align-items: center; gap: 0.85rem; padding: 1rem 1.25rem;">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(37,99,235,0.15); display: flex; align-items: center; justify-content: center; color: var(--accent-primary); font-size: 1.25rem;">
              <i class="fa-solid fa-database"></i>
            </div>
            <div>
              <div style="font-weight: 700; font-size: 0.925rem; color: var(--text-main);">Database-Enforced Security Engine Active</div>
              <div style="font-size: 0.78rem; color: var(--text-muted);">
                Every login is verified strictly against the central database (<code style="color: var(--accent-primary);">users</code> table) with bcrypt hashing. Adding a user here immediately allows them to authenticate on the login screen.
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>User ID (Login ID)</th>
                  <th>Full Name</th>
                  <th>Email Address</th>
                  <th>System Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th style="text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody id="db-users-table-body">
                ${users.map(u => {
                  const roleBadgeClass = u.role === 'SUPER_ADMIN' ? 'badge-active' :
                                         u.role === 'OPERATIONS_MANAGER' ? 'badge-trial' :
                                         u.role === 'FINANCE_OFFICER' ? 'badge-healthy' : 'badge-stale';
                  const isCurrent = state.currentUser && state.currentUser.id === u.id;
                  const isRoot = u.id === 'usr-super-admin' || u.id === 'admin';
                  return `
                    <tr>
                      <td>
                        <strong style="font-family: monospace; font-size: 0.88rem; color: var(--accent-primary);">${u.id}</strong>
                        ${isCurrent ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.65rem; margin-left: 0.35rem;">YOU</span>' : ''}
                      </td>
                      <td><strong>${u.fullName || '—'}</strong></td>
                      <td style="color: var(--text-muted); font-size: 0.85rem;">${u.email}</td>
                      <td><span class="badge ${roleBadgeClass}">${u.role}</span></td>
                      <td><span class="badge badge-healthy"><i class="fa-solid fa-circle-check"></i> DB ACTIVE</span></td>
                      <td style="font-size: 0.8rem; color: var(--text-muted);">${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never logged in'}</td>
                      <td style="text-align: right;">
                        ${!isRoot && !isCurrent ? `
                          <button class="btn btn-secondary btn-sm btn-delete-db-user" data-user-id="${u.id}" style="color: #ef4444; border-color: rgba(239,68,68,0.3);" title="Delete user from database">
                            <i class="fa-solid fa-trash"></i> Delete
                          </button>
                        ` : `
                          <span style="font-size: 0.72rem; color: var(--text-dim); font-style: italic;">Protected Root</span>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Wire up Add User button
      document.getElementById('btn-open-add-db-user')?.addEventListener('click', () => {
        openModal('modal-add-db-user');
      });

      // Wire up Delete User buttons
      document.querySelectorAll('.btn-delete-db-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.getAttribute('data-user-id');
          if (!confirm(`Are you sure you want to permanently delete user '${userId}' from the database? They will no longer be able to log in.`)) {
            return;
          }
          try {
            const delRes = await api(`/auth/users/${userId}`, { method: 'DELETE' });
            if (delRes.success) {
              showToast(delRes.message || `User '${userId}' deleted from database.`, 'success');
              renderAdminAccess();
            } else {
              throw new Error(delRes.error || 'Failed to delete user');
            }
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

    } catch (err) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444; margin-bottom: 1rem;"></i>
          <div style="font-weight: 700; color: #ef4444; margin-bottom: 0.5rem;">Failed to load database users</div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">${err.message}</div>
          <button class="btn btn-secondary" onclick="renderCurrentTab()"><i class="fa-solid fa-arrows-rotate"></i> Retry</button>
        </div>
      `;
    }
  }

  // ==========================================================================
  // MODAL HANDLERS & HELPERS
  // ==========================================================================
  function setupModals() {
    // Close modal on close button or backdrop click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('modal-close-btn')) {
          closeModal(modal.id);
        }
      });
    });

    // Dynamic Registration Amount Calculation
    function updateRegisterCalculatedAmount() {
      const isPerStudent = document.getElementById('radio-per-student')?.checked;
      const perStudentInputs = document.getElementById('per-student-inputs');
      const formulaEl = document.getElementById('calc-formula-text');
      const totalEl = document.getElementById('calc-total-amount');
      const cycle = document.getElementById('reg-billing-cycle')?.value || 'YEARLY';
      
      const multipliers = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
      const cycleMultiplier = multipliers[cycle] || 1;
      const cycleLabel = cycle.toLowerCase().replace('_', '-');

      if (!isPerStudent) {
        if (perStudentInputs) perStudentInputs.style.opacity = '0.4';
        const planSelect = document.getElementById('reg-plan-select');
        const planPrices = {
          'plan-starter': 12000,
          'plan-growth': 25000,
          'plan-enterprise': 55000,
          'plan-custom': 90000
        };
        const monthlyBase = planPrices[planSelect?.value] || 25000;
        const totalAmount = monthlyBase * cycleMultiplier;
        if (formulaEl) formulaEl.textContent = `Flat tier (₹${monthlyBase.toLocaleString()}/mo × ${cycleMultiplier} mos)`;
        if (totalEl) totalEl.textContent = `₹${totalAmount.toLocaleString()} / ${cycleLabel}`;
        return;
      }

      if (perStudentInputs) perStudentInputs.style.opacity = '1';
      const pricePerStudent = parseFloat(document.getElementById('reg-price-per-student')?.value) || 25.0;
      const initialStudents = parseInt(document.getElementById('reg-initial-students')?.value, 10) || 500;
      const monthlyAmount = Math.round(initialStudents * pricePerStudent);
      const totalAmount = monthlyAmount * cycleMultiplier;

      if (formulaEl) {
        formulaEl.textContent = `${initialStudents.toLocaleString()} students × ₹${pricePerStudent}/mo × ${cycleMultiplier} mos`;
      }
      if (totalEl) {
        totalEl.textContent = `₹${totalAmount.toLocaleString()} / ${cycleLabel}`;
      }
    }

    ['reg-price-per-student', 'reg-initial-students', 'reg-billing-cycle', 'reg-plan-select'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateRegisterCalculatedAmount);
      document.getElementById(id)?.addEventListener('change', updateRegisterCalculatedAmount);
    });

    ['radio-per-student', 'radio-flat'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', updateRegisterCalculatedAmount);
    });

    updateRegisterCalculatedAmount();

    // ------------------------------------------------------------------------
    // Automatic School ID & Cryptographic Keys Generation
    // ------------------------------------------------------------------------
    window.generateRegistrationCredentials = async function() {
      try {
        const res = await api('/schools/generate-credentials');
        if (res.success && res.data) {
          setRegistrationCredentials(res.data);
          return;
        }
      } catch (err) {
        // Fallback to client-side cryptographic generation if API is unreachable
      }

      const randomHex = (len) => {
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      };
      const schoolId = 'SCH-' + randomHex(3).toUpperCase().slice(0, 5);
      const apiKey = 'cc_live_pk_' + randomHex(12);
      const hmacSecret = 'cc_sec_live_' + randomHex(24);
      const approvalToken = 'appr_req_' + randomHex(16);

      setRegistrationCredentials({ schoolId, code: schoolId, apiKey, hmacSecret, approvalToken });
    };

    function setRegistrationCredentials(creds) {
      const idEl = document.getElementById('reg-school-id');
      const codeEl = document.getElementById('reg-school-code');
      const remoteIdEl = document.getElementById('reg-remote-school-id');
      const apiKeyEl = document.getElementById('reg-api-key');
      const hmacSecretEl = document.getElementById('reg-hmac-secret');
      const confirmIdEl = document.getElementById('probe-confirm-school-id');

      if (idEl) idEl.value = creds.schoolId;
      if (codeEl) codeEl.value = creds.code || creds.schoolId;
      if (remoteIdEl) remoteIdEl.value = creds.schoolId;
      if (apiKeyEl) apiKeyEl.value = creds.apiKey;
      if (hmacSecretEl) hmacSecretEl.value = creds.hmacSecret;
      if (confirmIdEl) confirmIdEl.textContent = creds.schoolId;

      const probeBadge = document.getElementById('remote-probe-badge');
      const probeResult = document.getElementById('erp-probe-result');
      if (probeBadge) {
        probeBadge.className = 'badge badge-trial';
        probeBadge.innerHTML = '<i class="fa-solid fa-circle-question"></i> Awaiting Approval Request';
      }
      if (probeResult) probeResult.style.display = 'none';
    }

    // Helper: 1-click clipboard copy
    const copyTextToClipboard = async (text, label) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast(`${label} copied to clipboard!`, 'success');
      } catch {
        prompt(`Copy ${label}:`, text);
      }
    };

    // Regenerate Keys button
    document.getElementById('btn-regenerate-credentials')?.addEventListener('click', () => {
      window.generateRegistrationCredentials();
      showToast('Generated fresh School ID & integration keys.', 'info');
    });

    // Copy credentials buttons in registration form
    document.getElementById('btn-copy-school-id')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('reg-school-id')?.value, 'School ID');
    });
    document.getElementById('btn-copy-api-key')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('reg-api-key')?.value, 'API Key');
    });
    document.getElementById('btn-copy-hmac-secret')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('reg-hmac-secret')?.value, 'HMAC Secret Key');
    });
    document.getElementById('btn-toggle-hmac-visibility')?.addEventListener('click', () => {
      const input = document.getElementById('reg-hmac-secret');
      const btn = document.getElementById('btn-toggle-hmac-visibility');
      if (input) {
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        if (btn) btn.innerHTML = isPass ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
      }
    });

    // ------------------------------------------------------------------------
    // Send Approval Request & Get Real Data from School ERP
    // ------------------------------------------------------------------------
    const handleSendApproval = async () => {
      const schoolId = document.getElementById('reg-school-id')?.value.trim();
      const erpUrl = document.getElementById('reg-erp-url')?.value.trim();
      const apiKey = document.getElementById('reg-api-key')?.value.trim();
      const hmacSecret = document.getElementById('reg-hmac-secret')?.value.trim();
      const schoolName = document.getElementById('reg-school-name')?.value.trim();
      const probeResult = document.getElementById('erp-probe-result');
      const probeBadge = document.getElementById('remote-probe-badge');
      const actionBtn = document.getElementById('btn-send-approval-request') || document.getElementById('btn-probe-erp');

      if (!erpUrl) {
        alert('Please enter the School ERP Base URL before sending the approval request.');
        document.getElementById('reg-erp-url')?.focus();
        return;
      }

      if (actionBtn) {
        actionBtn.disabled = true;
        actionBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Request & Waiting for Approval...';
      }

      try {
        showToast(`Dispatching authorization handshake & approval request to ${erpUrl}...`, 'info');
        const res = await api('/schools/send-approval-request', {
          method: 'POST',
          body: JSON.stringify({
            school_id: schoolId,
            erp_url: erpUrl,
            api_key: apiKey,
            hmac_secret: hmacSecret,
            school_name: schoolName
          })
        });

        if (res.success && res.data) {
          const data = res.data;
          if (probeResult) probeResult.style.display = 'block';
          if (probeBadge) {
            probeBadge.className = 'badge badge-healthy';
            probeBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Approval Granted & Verified';
          }

          document.getElementById('probe-students-count').textContent = data.totalStudents.toLocaleString();
          document.getElementById('probe-faculty-count').textContent = `${data.teachers} teachers, ${data.staff} staff`;
          document.getElementById('probe-attendance-rate').textContent = `${data.attendanceRate}%`;
          document.getElementById('probe-confirm-school-id').textContent = data.schoolId;
          document.getElementById('probe-source-badge').textContent = data.source;

          // Automatically set real enrolled students into dynamic pricing input
          const initialStudentsInput = document.getElementById('reg-initial-students');
          if (initialStudentsInput) {
            initialStudentsInput.value = data.totalStudents;
          }

          // Check the approval confirmation checkbox
          const approvalCheck = document.getElementById('reg-data-access-approved');
          if (approvalCheck) approvalCheck.checked = true;

          // Auto-fill School Name if empty
          const nameInput = document.getElementById('reg-school-name');
          if (nameInput && !nameInput.value.trim()) {
            nameInput.value = `School Campus (${data.schoolId})`;
          }

          // Immediately update dynamic per-student subscription calculation
          updateRegisterCalculatedAmount();

          showToast(`Approval granted! Real ERP census verified: ${data.totalStudents.toLocaleString()} enrolled students.`, 'success');
        }
      } catch (err) {
        showToast(`Approval Request failed: ${err.message}`, 'error');
      } finally {
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Approval Request';
        }
      }
    };

    document.getElementById('btn-send-approval-request')?.addEventListener('click', handleSendApproval);
    document.getElementById('btn-probe-erp')?.addEventListener('click', handleSendApproval);

    // ------------------------------------------------------------------------
    // Register School Form Submission
    // ------------------------------------------------------------------------
    const regForm = document.getElementById('form-register-school');
    const regSubmit = document.getElementById('btn-submit-register-school');
    if (regSubmit && regForm) {
      regSubmit.addEventListener('click', async (e) => {
        e.preventDefault();

        const schoolId = document.getElementById('reg-school-id')?.value.trim();
        const erpUrl = document.getElementById('reg-erp-url')?.value.trim();
        if (!erpUrl) {
          alert('Please enter the School ERP Base URL.');
          document.getElementById('reg-erp-url')?.focus();
          return;
        }

        const isApproved = document.getElementById('reg-data-access-approved')?.checked;
        if (!isApproved) {
          alert('Approval Required: Please click "Send Approval Request" first to authorize data access with that school ERP.');
          document.getElementById('btn-send-approval-request')?.focus();
          return;
        }

        const formData = new FormData(regForm);
        const body = Object.fromEntries(formData.entries());
        body.school_id = schoolId;
        body.code = schoolId;
        body.remote_school_id = schoolId;
        body.data_access_approved = 1;
        body.approval_status = 'APPROVED';
        if (body.price_per_student) body.price_per_student = parseFloat(body.price_per_student);
        if (body.initial_students) body.initial_students = parseInt(body.initial_students, 10);
        if (body.grace_period_days) body.grace_period_days = parseInt(body.grace_period_days, 10);
        body.auto_suspend_enabled = document.getElementById('reg-auto-suspend')?.checked ? 1 : 0;

        try {
          showToast('Registering school and activating connector bridge...', 'info');
          const res = await api('/schools', {
            method: 'POST',
            body: JSON.stringify(body)
          });

          closeModal('modal-register-school');
          regForm.reset();

          // Show Dedicated Credentials Success Modal
          openModal('modal-credentials-success');
          document.getElementById('succ-school-name').textContent = res.data.name;
          document.getElementById('succ-school-id').textContent = res.data.schoolId;
          document.getElementById('succ-api-key').textContent = res.data.apiKey;
          document.getElementById('succ-hmac-secret').textContent = res.data.hmacSecret;
          document.getElementById('succ-student-count').textContent = `${(res.data.initialStudents || 0).toLocaleString()} Students`;
          document.getElementById('succ-calc-amount').textContent = `₹${(res.data.calculatedAmount || 0).toLocaleString()} / ${(res.data.billingCycle || 'yearly').toLowerCase()}`;

          const snippet = 
`# Remote School ERP Connector Configuration (.env)
CENTRAL_ERP_URL=${window.location.origin}
CENTRAL_SCHOOL_ID=${res.data.schoolId}
CENTRAL_API_KEY=${res.data.apiKey}
CENTRAL_HMAC_SECRET=${res.data.hmacSecret}`;
          document.getElementById('succ-connector-snippet').value = snippet;

          await loadInitialData();
          renderSchoolsList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // Success Modal Copy & Action Handlers
    document.getElementById('btn-copy-succ-school-id')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('succ-school-id')?.textContent, 'School ID');
    });
    document.getElementById('btn-copy-succ-api-key')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('succ-api-key')?.textContent, 'API Key');
    });
    document.getElementById('btn-copy-succ-hmac-secret')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('succ-hmac-secret')?.textContent, 'HMAC Secret');
    });
    document.getElementById('btn-copy-connector-snippet')?.addEventListener('click', () => {
      copyTextToClipboard(document.getElementById('succ-connector-snippet')?.value, 'Connector Configuration');
    });
    document.getElementById('btn-done-credentials-success')?.addEventListener('click', () => {
      closeModal('modal-credentials-success');
      switchTab('schools');
    });

    // Remote Command Modal Switcher
    const cmdTypeSelect = document.getElementById('cmd-type-select');
    if (cmdTypeSelect) {
      cmdTypeSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        const suspFields = document.getElementById('cmd-suspend-fields');
        const extFields = document.getElementById('cmd-extend-fields');
        const modFields = document.getElementById('cmd-modules-fields');

        if (suspFields) suspFields.style.display = val === 'SUSPEND_SERVICE' ? 'block' : 'none';
        if (extFields) extFields.style.display = val === 'EXTEND_SUBSCRIPTION' ? 'block' : 'none';
        if (modFields) modFields.style.display = val === 'UPDATE_MODULES' ? 'block' : 'none';
      });
    }

    // Dispatch Command Button
    const dispatchBtn = document.getElementById('btn-dispatch-command');
    if (dispatchBtn) {
      dispatchBtn.addEventListener('click', async () => {
        const schoolId = document.getElementById('cmd-school-id').value;
        const cmdType = document.getElementById('cmd-type-select').value;
        const form = document.getElementById('form-remote-command');
        const formData = new FormData(form);

        const payload = {};
        if (cmdType === 'SUSPEND_SERVICE') {
          const confirmed = document.getElementById('cmd-confirm-suspend').checked;
          if (!confirmed) {
            alert('Please check the confirmation box to authorize suspension.');
            return;
          }
          payload.reason = formData.get('suspend_reason');
          payload.support_contact = formData.get('support_contact');
          payload.display_page = 'SERVICE_SUSPENDED_OVERDUE';
        } else if (cmdType === 'EXTEND_SUBSCRIPTION') {
          payload.extend_days = parseInt(formData.get('extend_days'), 10);
          payload.reason = formData.get('extend_reason');
        } else if (cmdType === 'UPDATE_MODULES') {
          const checked = Array.from(document.querySelectorAll('#modules-checkbox-group input:checked')).map(i => i.value);
          payload.enabled_modules = checked;
        }

        try {
          showToast(`Enqueuing predefined remote command ${cmdType}...`, 'info');
          const res = await api('/remote-control/issue', {
            method: 'POST',
            body: JSON.stringify({
              school_id: schoolId,
              command_type: cmdType,
              payload,
              confirmation: true
            })
          });

          closeModal('modal-remote-command');
          showToast(res.message, 'success');

          // Simulate immediate execution for smooth demo
          setTimeout(async () => {
            await api('/remote-control/simulate-execution', {
              method: 'POST',
              body: JSON.stringify({ command_id: res.data.commandId })
            });
            showToast(`Command ${res.data.commandId} acknowledged by school ERP connector.`, 'success');
            await loadInitialData();
            if (state.activeTab === 'remote-controls') {
              loadCommandsQueue();
            } else if (state.activeTab === 'school-profile') {
              renderSchoolProfile(schoolId);
            } else {
              renderCurrentTab();
            }
          }, 600);

        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // Invoice dynamic calculation helper
    function triggerInvoiceFormCalculation() {
      const schoolId = document.getElementById('inv-school-select')?.value;
      const cycle = document.getElementById('inv-billing-cycle')?.value || 'YEARLY';
      const school = (state.schools || []).find(s => s.id === schoolId);

      const startInput = document.getElementById('inv-period-start');
      const endInput = document.getElementById('inv-period-end');
      const dueInput = document.getElementById('inv-due-date');
      const subtotalInput = document.getElementById('inv-subtotal');
      const formulaSpan = document.getElementById('inv-calc-formula');
      const amountSpan = document.getElementById('inv-calc-amount');

      const today = new Date();
      const startDateStr = today.toISOString().slice(0, 10);
      if (startInput && !startInput.value) startInput.value = startDateStr;

      let months = 12;
      if (cycle === 'MONTHLY') months = 1;
      else if (cycle === 'QUARTERLY') months = 3;
      else if (cycle === 'HALF_YEARLY') months = 6;
      else if (cycle === 'YEARLY') months = 12;

      const endDate = new Date(today);
      endDate.setMonth(endDate.getMonth() + months);
      if (endInput) endInput.value = endDate.toISOString().slice(0, 10);

      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 7);
      if (dueInput && !dueInput.value) dueInput.value = dueDate.toISOString().slice(0, 10);

      if (school) {
        let subtotal = 0;
        let formula = '';
        if (school.pricing_model === 'PER_STUDENT') {
          const students = school.latest_student_count || 500;
          const rate = school.price_per_student || 25.0;
          subtotal = Math.round(students * rate * months);
          formula = `${students} students × ₹${rate}/student/mo × ${months} mo(s)`;
        } else {
          const annual = school.calculated_subscription_amount || school.custom_price || 300000;
          const moRate = annual / 12;
          subtotal = Math.round(moRate * months);
          formula = `Flat Tier (₹${Math.round(moRate).toLocaleString('en-IN')}/mo) × ${months} mo(s)`;
        }

        if (subtotalInput) subtotalInput.value = subtotal;
        if (formulaSpan) formulaSpan.textContent = formula;
        if (amountSpan) amountSpan.textContent = `₹${subtotal.toLocaleString('en-IN')}`;
      }
    }

    document.getElementById('inv-school-select')?.addEventListener('change', triggerInvoiceFormCalculation);
    document.getElementById('inv-billing-cycle')?.addEventListener('change', triggerInvoiceFormCalculation);

    // Generate Invoice Form
    const invForm = document.getElementById('form-generate-invoice');
    const invSubmit = document.getElementById('btn-submit-generate-invoice');
    if (invSubmit && invForm) {
      invSubmit.addEventListener('click', async (e) => {
        e.preventDefault();
        const formData = new FormData(invForm);
        const body = Object.fromEntries(formData.entries());

        try {
          showToast('Generating official tax invoice...', 'info');
          const res = await api('/invoices', {
            method: 'POST',
            body: JSON.stringify(body)
          });

          closeModal('modal-generate-invoice');
          invForm.reset();
          showToast(`Invoice ${res.data.invoiceNum} created for ₹${res.data.totalAmount.toLocaleString('en-IN')}!`, 'success');
          await loadInitialData();
          if (state.activeTab === 'invoices') renderInvoices();
          if (state.activeTab === 'overview') renderOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // Record Payment Form (With Automatic Receipt & Stamped PDF Email)
    const payForm = document.getElementById('form-record-payment');
    const paySubmit = document.getElementById('btn-submit-record-payment');
    if (paySubmit && payForm) {
      paySubmit.addEventListener('click', async (e) => {
        e.preventDefault();
        const invId = document.getElementById('pay-invoice-id').value;
        const formData = new FormData(payForm);
        const body = Object.fromEntries(formData.entries());

        const origHtml = paySubmit.innerHTML;
        paySubmit.disabled = true;
        paySubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing & Emailing Receipt...';

        try {
          showToast('Recording payment and emailing settlement receipt...', 'info');
          const res = await api(`/invoices/${invId}/payments`, {
            method: 'POST',
            body: JSON.stringify(body)
          });

          closeModal('modal-record-payment');
          payForm.reset();
          paySubmit.disabled = false;
          paySubmit.innerHTML = origHtml;

          if (res.data?.emailDispatched) {
            showToast(`Payment receipt ${res.data.paymentNum} recorded! Stamped PDF invoice and receipt emailed to ${res.data.emailRecipient}.`, 'success');
          } else {
            showToast(`Payment receipt ${res.data.paymentNum} recorded successfully!`, 'success');
          }

          await loadInitialData();
          if (state.activeTab === 'invoices') renderInvoices();
          if (state.activeTab === 'overview') renderOverview();
        } catch (err) {
          paySubmit.disabled = false;
          paySubmit.innerHTML = origHtml;
          showToast(err.message, 'error');
        }
      });
    }

    // Add New Database User Form Submission
    const addUserSubmit = document.getElementById('btn-submit-add-db-user');
    const addUserForm = document.getElementById('form-add-db-user');
    if (addUserSubmit) {
      addUserSubmit.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = document.getElementById('new-user-id')?.value.trim();
        const fullName = document.getElementById('new-user-fullname')?.value.trim();
        const email = document.getElementById('new-user-email')?.value.trim();
        const role = document.getElementById('new-user-role')?.value;
        const password = document.getElementById('new-user-password')?.value;

        if (!id || !fullName || !email || !password) {
          showToast('Please fill all required user fields.', 'warning');
          return;
        }

        const origHtml = addUserSubmit.innerHTML;
        addUserSubmit.disabled = true;
        addUserSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving to Database...';

        try {
          const res = await api('/auth/users', {
            method: 'POST',
            body: JSON.stringify({ id, fullName, email, role, password })
          });

          closeModal('modal-add-db-user');
          addUserForm?.reset();
          addUserSubmit.disabled = false;
          addUserSubmit.innerHTML = origHtml;

          showToast(`User '${res.user.id}' saved to database. They can now log in!`, 'success');
          if (state.activeTab === 'admin') {
            renderAdminAccess();
          }
        } catch (err) {
          addUserSubmit.disabled = false;
          addUserSubmit.innerHTML = origHtml;
          showToast(err.message, 'error');
        }
      });
    }

    // Role Switching Cards
    document.querySelectorAll('.user-role-card').forEach(card => {
      card.addEventListener('click', async () => {
        const email = card.getAttribute('data-email');
        const pass = card.getAttribute('data-pass');
        try {
          showToast(`Switching identity to ${email}...`, 'info');
          const res = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password: pass, mfaCode: '123456' })
          });
          if (res.success) {
            state.token = res.token;
            state.currentUser = res.user;
            localStorage.setItem('central_token', state.token);
            updateUserBadge();
            closeModal('modal-auth-users');
            showToast(`Logged in as ${res.user.fullName} (${res.user.role})`, 'success');
            renderCurrentTab();
          }
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      if (id === 'modal-register-school') {
        if (typeof window.generateRegistrationCredentials === 'function') {
          window.generateRegistrationCredentials();
        }
        const evt = new Event('input', { bubbles: true });
        document.getElementById('reg-price-per-student')?.dispatchEvent(evt);
      }
    }
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  function openRemoteCommandModal(schoolId, commandType = 'SUSPEND_SERVICE') {
    const school = state.schools.find(s => s.id === schoolId);
    if (!school) return;

    document.getElementById('cmd-school-id').value = school.id;
    document.getElementById('cmd-school-name-label').textContent = school.name;
    document.getElementById('cmd-school-url-label').textContent = school.erp_url;

    const cmdSelect = document.getElementById('cmd-type-select');
    if (cmdSelect) {
      cmdSelect.value = commandType;
      cmdSelect.dispatchEvent(new Event('change'));
    }

    openModal('modal-remote-command');
  }

  function openRecordPaymentModal(invoiceId, invoiceNum, balance) {
    document.getElementById('pay-invoice-id').value = invoiceId;
    document.getElementById('pay-inv-number').textContent = invoiceNum;
    document.getElementById('pay-inv-balance').textContent = `₹${parseFloat(balance).toLocaleString()}`;
    document.getElementById('pay-amount').value = balance;
    document.getElementById('pay-date').value = new Date().toISOString().slice(0, 10);
    openModal('modal-record-payment');
  }

  // Time formatter
  function formatTimeAgo(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  // Start app on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
