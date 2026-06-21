/**
 * app.js
 * Core application controller for SISMA Plain HTML/CSS/JS Frontend.
 * Implements clean state management, hash routing, GSI OAuth, XSS prevention, and print controls.
 */

// Global State
const STATE = {
  user: null,
  token: null,
  activeView: 'dashboard',
  assets: [],
  selectedAsset: null,
  cachedStats: null,
  theme: 'light',
  // Configuration options (can be overridden in UI settings)
  apiBaseUrl: localStorage.getItem('sisma_api_url') || 'https://script.google.com/macros/library/d/1RFhwQVzj2sX1Hewj0EgaymDwC26IadYEgUZYSOBgyRN3DnYzAX5UcBLM/2', 
  googleClientId: localStorage.getItem('sisma_google_client_id') || '584473225066-8564o8cu6n788pko626j64g9fn1qps7s.apps.googleusercontent.com',
  // UI States
  loadingAssets: false,
  submittingForm: false,
  assetFilters: {
    page: 1,
    limit: 10,
    search: '',
    category: '',
    condition: '',
    status: ''
  }
};

// Enums & Mappings
const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  BRANCH_ADMIN: 'BRANCH_ADMIN',
  TEACHER: 'TEACHER'
};

const CATEGORY_OPTIONS = [
  { id: 'LAPTOP', label: 'Laptop' },
  { id: 'PROYEKTOR', label: 'Proyektor' },
  { id: 'KURSI', label: 'Kursi' },
  { id: 'MEJA', label: 'Meja' },
  { id: 'AC', label: 'AC / Pendingin Ruangan' },
  { id: 'LAINNYA', label: 'Lain-lain' }
];

const BRANCH_OPTIONS = [
  { id: 'CBG01', label: 'Cabang Utama' },
  { id: 'CBG02', label: 'Cabang Pembantu' },
  { id: 'CBG03', label: 'Cabang Khusus' }
];

const ROOM_OPTIONS = [
  { id: 'RUANG_KELAS_1', label: 'Ruang Kelas 1' },
  { id: 'LAB_KOMPUTER', label: 'Lab Komputer' },
  { id: 'RUANG_GURU', label: 'Ruang Guru' },
  { id: 'AULA', label: 'Aula' }
];

const PIC_OPTIONS = [
  { id: 'USR001', label: 'Pak Budi' },
  { id: 'USR002', label: 'Ibu Ani' },
  { id: 'USR003', label: 'Pak Eko' }
];

const STATUS_LABELS = {
  AVAILABLE: 'Tersedia',
  BORROWED: 'Dipinjam',
  MAINTENANCE: 'Perbaikan',
  DAMAGED: 'Rusak',
  DELETED: 'Dihapus',
  PENDING: 'Menunggu',
  COMPLETED: 'Selesai',
  RETURNED: 'Dikembalikan'
};

const CONDITION_LABELS = {
  GOOD: 'Baik',
  MINOR_DAMAGE: 'Kerusakan Ringan',
  MAJOR_DAMAGE: 'Kerusakan Berat'
};

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  BRANCH_ADMIN: 'Admin Cabang',
  TEACHER: 'Guru'
};

const TRANSACTIONS_LABELS = {
  CREATE: 'Pembuatan',
  BORROW: 'Peminjaman',
  RETURN: 'Pengembalian',
  MAINTENANCE_START: 'Mulai Perbaikan',
  MAINTENANCE_END: 'Selesai Perbaikan',
  TRANSFER: 'Transfer',
  DELETE: 'Penghapusan',
  INSPECT: 'Inspeksi'
};

const BADGE_VARIANTS = {
  AVAILABLE: 'success',
  BORROWED: 'info',
  MAINTENANCE: 'warning',
  DAMAGED: 'danger',
  DELETED: 'default',
  PENDING: 'warning',
  COMPLETED: 'success',
  RETURNED: 'success',
  GOOD: 'success',
  MINOR_DAMAGE: 'warning',
  MAJOR_DAMAGE: 'danger'
};

// Global Charts variables
let assetStatusChart = null;
let assetConditionChart = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupConfigUI();
  setupEventListeners();
  checkSession();
  
  // Create Lucide Icons
  lucide.createIcons();
});

// -------------------------------------------------------------
// 1. Core API Client Setup
// -------------------------------------------------------------
async function apiRequest(endpoint, options = {}) {
  if (!STATE.apiBaseUrl) {
    showNotice('URL API Backend belum dikonfigurasi!', 'error');
    throw new Error('API Base URL is not configured.');
  }

  const { method = 'GET', body, params = {} } = options;
  
  // Build GAS Target URL
  const gasUrl = new URL(STATE.apiBaseUrl);
  gasUrl.searchParams.set('path', endpoint);
  
  // Attach query params
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== '') {
      gasUrl.searchParams.set(key, String(val));
    }
  });

  // Attach JWT Bearer Token in query parameter for GAS compatibility
  if (STATE.token) {
    gasUrl.searchParams.set('token', STATE.token);
  }

  // Handle PUT/DELETE method overrides (since GAS only accepts GET and POST)
  let fetchMethod = method;
  let requestBody = body;
  
  if (method === 'PUT') {
    fetchMethod = 'POST';
    gasUrl.searchParams.set('method', 'PUT');
  } else if (method === 'DELETE') {
    fetchMethod = 'POST';
    gasUrl.searchParams.set('method', 'DELETE');
  }

  const fetchOptions = {
    method: fetchMethod,
    redirect: 'follow', // GAS redirects to temporary user content URL
    headers: {}
  };

  if (requestBody && fetchMethod !== 'GET') {
    // We use 'text/plain' instead of 'application/json' to prevent the browser from sending 
    // a CORS preflight OPTIONS request, which Google Apps Script does not support.
    fetchOptions.headers['Content-Type'] = 'text/plain';
    fetchOptions.body = JSON.stringify(requestBody);
  }

  try {
    const response = await fetch(gasUrl.toString(), fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Request Error:', error);
    showNotice(`Koneksi API Gagal: ${error.message}`, 'error');
    throw error;
  }
}

// -------------------------------------------------------------
// 2. Session & Authentication
// -------------------------------------------------------------
function checkSession() {
  const token = sessionStorage.getItem('sisma_token');
  const userStr = sessionStorage.getItem('sisma_user');
  
  if (token && userStr) {
    STATE.token = token;
    STATE.user = JSON.parse(userStr);
    renderAuthenticatedState();
    loadActiveView();
  } else {
    renderLoginState();
  }
}

function handleLoginSuccess(sessionData) {
  STATE.token = sessionData.token;
  STATE.user = sessionData.user;
  
  sessionStorage.setItem('sisma_token', sessionData.token);
  sessionStorage.setItem('sisma_user', JSON.stringify(sessionData.user));
  
  showNotice(`Selamat datang, ${sessionData.user.name}!`, 'success');
  renderAuthenticatedState();
  
  // Set default view hash and load
  window.location.hash = '#dashboard';
  switchView('dashboard');
}

function logout() {
  if (STATE.token) {
    apiRequest('/api/v1/auth/logout', { method: 'POST' })
      .catch(() => {}); // Silent catch, clear token locally anyway
  }
  
  STATE.token = null;
  STATE.user = null;
  sessionStorage.removeItem('sisma_token');
  sessionStorage.removeItem('sisma_user');
  
  showNotice('Logout berhasil.', 'info');
  renderLoginState();
}

// Google OAuth Credential Handler (called by GSI)
async function handleCredentialResponse(response) {
  try {
    const res = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { id_token: response.credential }
    });
    
    if (res.success && res.data) {
      handleLoginSuccess(res.data);
    } else {
      showNotice(res.message || 'Login gagal. Akun tidak terdaftar.', 'error');
    }
  } catch (error) {
    showNotice('Gagal menghubungkan login Google.', 'error');
  }
}

// -------------------------------------------------------------
// 3. Routing & View Switching
// -------------------------------------------------------------
function setupEventListeners() {
  // Hash change router
  window.addEventListener('hashchange', () => {
    if (!STATE.token) return; // Ignore hash changes if logged out
    const view = window.location.hash.substring(1) || 'dashboard';
    switchView(view);
  });

  // Sidebar toggle for mobile
  document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('active');
  });

  // Theme switch button
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Dev login form bypass
  document.getElementById('dev-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('dev-email-input').value.trim();
    if (!email) return;
    
    try {
      const res = await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { email }
      });
      
      if (res.success && res.data) {
        handleLoginSuccess(res.data);
      } else {
        showNotice(res.message || 'Email tidak aktif atau tidak ditemukan.', 'error');
      }
    } catch (e) {
      showNotice('Koneksi ke backend bermasalah.', 'error');
    }
  });

  // Modal auto-close setup
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Close modals on escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  // Asset search & filters
  const searchInput = document.getElementById('asset-search-input');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      STATE.assetFilters.search = e.target.value;
      STATE.assetFilters.page = 1;
      fetchAssets();
    }, 400);
  });

  document.getElementById('asset-filter-category').addEventListener('change', (e) => {
    STATE.assetFilters.category = e.target.value;
    STATE.assetFilters.page = 1;
    fetchAssets();
  });
  
  document.getElementById('asset-filter-condition').addEventListener('change', (e) => {
    STATE.assetFilters.condition = e.target.value;
    STATE.assetFilters.page = 1;
    fetchAssets();
  });

  document.getElementById('asset-filter-status').addEventListener('change', (e) => {
    STATE.assetFilters.status = e.target.value;
    STATE.assetFilters.page = 1;
    fetchAssets();
  });

  // Modal triggers & dynamic dropdown fetch
  document.getElementById('btn-add-asset-modal').addEventListener('click', () => {
    openModal('modal-add-asset');
  });

  document.getElementById('btn-new-borrowing').addEventListener('click', async () => {
    openModal('modal-new-borrowing');
    const select = document.getElementById('borrow-asset-select');
    renderAssetsDropdown(select, { status: 'AVAILABLE' });
  });

  document.getElementById('btn-new-maintenance').addEventListener('click', async () => {
    openModal('modal-new-maintenance');
    const select = document.getElementById('maintenance-asset-select');
    renderAssetsDropdown(select, { condition: 'DAMAGED' });
  });

  document.getElementById('btn-new-inspection').addEventListener('click', async () => {
    openModal('modal-new-inspection');
    const select = document.getElementById('inspection-asset-select');
    renderAssetsDropdown(select);
  });

  document.getElementById('btn-new-transfer').addEventListener('click', async () => {
    openModal('modal-new-transfer');
    const select = document.getElementById('transfer-asset-select');
    renderAssetsDropdown(select);
  });

  // Handle dynamic dropdown room changes based on branch selection
  const formAdd = document.getElementById('form-add-asset');
  formAdd.elements['branch_id'].addEventListener('change', (e) => {
    renderRoomsDropdown(formAdd.elements['room_id'], e.target.value);
  });

  const formEdit = document.getElementById('form-edit-asset');
  formEdit.elements['branch_id'].addEventListener('change', (e) => {
    renderRoomsDropdown(formEdit.elements['room_id'], e.target.value);
  });

  const formTransfer = document.getElementById('form-new-transfer');
  formTransfer.elements['target_branch_id'].addEventListener('change', (e) => {
    renderRoomsDropdown(formTransfer.elements['target_room_id'], e.target.value);
  });

  // Forms Submissions
  document.getElementById('form-add-asset').addEventListener('submit', handleAddAssetSubmit);
  document.getElementById('form-edit-asset').addEventListener('submit', handleEditAssetSubmit);
  document.getElementById('form-new-borrowing').addEventListener('submit', handleNewBorrowingSubmit);
  document.getElementById('form-return-asset').addEventListener('submit', handleReturnAssetSubmit);
  document.getElementById('form-new-maintenance').addEventListener('submit', handleNewMaintenanceSubmit);
  document.getElementById('form-resolve-maintenance').addEventListener('submit', handleResolveMaintenanceSubmit);
  document.getElementById('form-new-inspection').addEventListener('submit', handleNewInspectionSubmit);
  document.getElementById('form-new-transfer').addEventListener('submit', handleNewTransferSubmit);

  // Reports selection
  document.querySelectorAll('.report-type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.report-type-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });
  });

  document.getElementById('btn-generate-report').addEventListener('click', generateReport);
  document.getElementById('btn-print-report').addEventListener('click', () => window.print());
}

function loadActiveView() {
  const hash = window.location.hash.substring(1) || 'dashboard';
  switchView(hash);
}

function switchView(viewName) {
  STATE.activeView = viewName;
  
  // Strip off parameter routers for simple titles
  const cleanViewName = viewName.split('/')[0];
  
  // Close sidebar on mobile after transition
  document.getElementById('sidebar').classList.remove('active');

  // Update view navigation highlighting
  document.querySelectorAll('.sidebar-item').forEach(item => {
    const itemView = item.getAttribute('data-view');
    if (itemView === cleanViewName || (cleanViewName === 'asset-detail' && itemView === 'assets')) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Show/Hide section divs
  document.querySelectorAll('.view-section').forEach(section => {
    if (section.id === `view-${viewName}`) {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Set Topbar title
  const viewTitles = {
    dashboard: 'Dashboard',
    assets: 'Manajemen Aset',
    borrowings: 'Log Peminjaman',
    maintenance: 'Tiket Perbaikan',
    inspections: 'Fisik & Inspeksi',
    transfers: 'Mutasi & Transfer',
    reports: 'Cetak Laporan',
    'asset-detail': 'Detail Aset'
  };
  
  document.getElementById('view-title').textContent = viewTitles[cleanViewName] || 'SISMA Portal';

  // Load specific view data
  if (cleanViewName === 'dashboard') {
    loadDashboardView();
  } else if (cleanViewName === 'assets') {
    fetchAssets();
  } else if (cleanViewName === 'borrowings') {
    fetchBorrowings();
  } else if (cleanViewName === 'maintenance') {
    fetchMaintenances();
  } else if (cleanViewName === 'inspections') {
    fetchInspections();
  } else if (cleanViewName === 'transfers') {
    fetchTransfers();
  } else if (cleanViewName === 'reports') {
    initReportsDropdowns();
  } else if (cleanViewName === 'asset-detail') {
    const assetId = viewName.substring(viewName.indexOf('/') + 1);
    fetchAssetDetail(assetId);
  }
}

// -------------------------------------------------------------
// 4. View Handlers: Dashboard
// -------------------------------------------------------------
async function loadDashboardView() {
  try {
    const isGlobal = STATE.user.role === ROLES.SUPER_ADMIN;
    const endpoint = isGlobal ? '/api/v1/dashboard' : '/api/v1/dashboard/branch';
    const params = isGlobal ? {} : { branch_id: STATE.user.branch_id };

    const res = await apiRequest(endpoint, { params });
    if (res.success && res.data) {
      const stats = res.data;
      STATE.cachedStats = stats;
      
      // Update UI Counts
      document.getElementById('dash-total-assets').textContent = stats.total_assets;
      document.getElementById('dash-borrowed-assets').textContent = stats.active_borrowings;
      document.getElementById('dash-pending-maintenance').textContent = stats.status_breakdown.MAINTENANCE || 0;
      document.getElementById('dash-damaged-assets').textContent = (stats.condition_breakdown.MINOR_DAMAGE || 0) + (stats.condition_breakdown.MAJOR_DAMAGE || 0);

      // Render Charts
      renderDashboardCharts(stats);

      // Render Recent activities safely
      renderRecentActivities(stats.recent_transactions);
    }
  } catch (error) {
    console.error('Failed to load dashboard:', error);
  }
}

function renderDashboardCharts(stats) {
  // Chart status
  const statusCtx = document.getElementById('chart-asset-status').getContext('2d');
  if (assetStatusChart) assetStatusChart.destroy();
  
  const statusData = stats.status_breakdown;
  assetStatusChart = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: ['Tersedia', 'Dipinjam', 'Perbaikan', 'Rusak'],
      datasets: [{
        data: [
          statusData.AVAILABLE || 0,
          statusData.BORROWED || 0,
          statusData.MAINTENANCE || 0,
          statusData.DAMAGED || 0
        ],
        backgroundColor: ['#38a169', '#3182ce', '#dd6b20', '#e53e3e'],
        borderWidth: 2,
        borderColor: getCSSVariable('--surface')
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: getCSSVariable('--foreground') }
        }
      }
    }
  });

  // Chart condition
  const conditionCtx = document.getElementById('chart-asset-condition').getContext('2d');
  if (assetConditionChart) assetConditionChart.destroy();

  const condData = stats.condition_breakdown;
  assetConditionChart = new Chart(conditionCtx, {
    type: 'doughnut',
    data: {
      labels: ['Baik', 'Rusak Ringan', 'Rusak Berat'],
      datasets: [{
        data: [
          condData.GOOD || 0,
          condData.MINOR_DAMAGE || 0,
          condData.MAJOR_DAMAGE || 0
        ],
        backgroundColor: ['#48bb78', '#ed8936', '#f56565'],
        borderWidth: 2,
        borderColor: getCSSVariable('--surface')
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: getCSSVariable('--foreground') }
        }
      }
    }
  });
}

function renderRecentActivities(transactions) {
  const listEl = document.getElementById('recent-activity-list');
  listEl.innerHTML = ''; // Clear

  if (!transactions || transactions.length === 0) {
    listEl.appendChild(createEmptyState('clipboard-x', 'Tidak Ada Aktivitas', 'Belum ada catatan aktivitas baru-baru ini.'));
    return;
  }

  transactions.forEach(t => {
    const li = document.createElement('li');
    li.className = 'activity-item';

    // Dot class based on activity
    let typeClass = 'asset';
    let iconName = 'package';
    
    if (t.trx_type === 'BORROW') {
      typeClass = 'borrow';
      iconName = 'arrow-right-left';
    } else if (t.trx_type === 'RETURN') {
      typeClass = 'audit';
      iconName = 'check';
    } else if (t.trx_type === 'MAINTENANCE_START' || t.trx_type === 'MAINTENANCE_END') {
      typeClass = 'maintenance';
      iconName = 'wrench';
    } else if (t.trx_type === 'TRANSFER') {
      typeClass = 'transfer';
      iconName = 'truck';
    } else if (t.trx_type === 'INSPECT') {
      typeClass = 'audit';
      iconName = 'clipboard-check';
    }

    const dot = document.createElement('div');
    dot.className = `activity-dot ${typeClass}`;
    dot.innerHTML = `<i data-lucide="${iconName}" style="width: 16px; height: 16px;"></i>`;

    const content = document.createElement('div');
    content.className = 'activity-content';

    const header = document.createElement('div');
    header.className = 'activity-header';
    
    const title = document.createElement('span');
    title.className = 'activity-title';
    title.textContent = `${TRANSACTIONS_LABELS[t.trx_type] || t.trx_type} - ${t.asset_id}`;
    
    const time = document.createElement('span');
    time.className = 'activity-time';
    time.textContent = formatDate(t.created_at);

    header.appendChild(title);
    header.appendChild(time);

    const desc = document.createElement('p');
    desc.className = 'activity-desc';
    // Decodes database escaped string safely
    desc.textContent = `${decodeHtml(t.description)} (oleh ${t.created_by})`;

    content.appendChild(header);
    content.appendChild(desc);

    li.appendChild(dot);
    li.appendChild(content);
    listEl.appendChild(li);
  });

  // Re-draw lucide icons inside dynamically created elements
  lucide.createIcons();
}

// -------------------------------------------------------------
// 5. View Handlers: Assets
// -------------------------------------------------------------
async function fetchAssets() {
  const tbody = document.getElementById('assets-table-body');
  renderTableSkeleton(tbody, 7);

  try {
    const params = {
      limit: STATE.assetFilters.limit,
      offset: (STATE.assetFilters.page - 1) * STATE.assetFilters.limit
    };

    if (STATE.assetFilters.search) params.search = STATE.assetFilters.search;
    if (STATE.assetFilters.category) params.category_id = STATE.assetFilters.category;
    if (STATE.assetFilters.condition) params.condition = STATE.assetFilters.condition;
    if (STATE.assetFilters.status) params.status = STATE.assetFilters.status;

    const res = await apiRequest('/api/v1/assets', { params });
    tbody.innerHTML = ''; // Clear

    if (res.success && res.data) {
      STATE.assets = res.data;
      
      if (res.data.length === 0) {
        tbody.appendChild(createEmptyStateRow(7, 'package-open', 'Tidak Ada Aset', 'Aset tidak ditemukan atau data kosong.'));
        updatePaginationInfo(0, 0, 1);
        return;
      }

      res.data.forEach(item => {
        const tr = document.createElement('tr');
        
        // ID Aset
        const tdId = document.createElement('td');
        tdId.textContent = item.asset_id;
        tdId.style.fontFamily = 'monospace';
        tdId.style.fontWeight = 'bold';
        
        // Nama Aset / Merek
        const tdName = document.createElement('td');
        const nameDiv = document.createElement('div');
        nameDiv.style.display = 'flex';
        nameDiv.style.flexDirection = 'column';
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = '600';
        nameSpan.textContent = decodeHtml(item.item_name);
        const brandSpan = document.createElement('span');
        brandSpan.style.fontSize = '0.75rem';
        brandSpan.style.color = 'var(--foreground-muted)';
        brandSpan.textContent = item.brand ? decodeHtml(item.brand) : 'Tanpa Merek';
        nameDiv.appendChild(nameSpan);
        nameDiv.appendChild(brandSpan);
        tdName.appendChild(nameDiv);

        // Kategori
        const tdCategory = document.createElement('td');
        const catOpt = CATEGORY_OPTIONS.find(c => c.id === item.category_id);
        tdCategory.textContent = catOpt ? catOpt.label : item.category_id;

        // Lokasi
        const tdLocation = document.createElement('td');
        const branchOpt = BRANCH_OPTIONS.find(b => b.id === item.branch_id);
        const roomOpt = ROOM_OPTIONS.find(r => r.id === item.room_id);
        const branchLabel = branchOpt ? branchOpt.label : item.branch_id;
        const roomLabel = roomOpt ? roomOpt.label : item.room_id;
        tdLocation.textContent = `${branchLabel} — ${roomLabel}`;

        // Kondisi
        const tdCondition = document.createElement('td');
        const condLabel = CONDITION_LABELS[item.condition] || item.condition;
        const condVariant = BADGE_VARIANTS[item.condition] || 'default';
        tdCondition.innerHTML = `<span class="badge badge-${condVariant}">${condLabel}</span>`;

        // Status
        const tdStatus = document.createElement('td');
        const statusLabel = STATUS_LABELS[item.status] || item.status;
        const statusVariant = BADGE_VARIANTS[item.status] || 'default';
        tdStatus.innerHTML = `<span class="badge badge-${statusVariant}">${statusLabel}</span>`;

        // Actions
        const tdActions = document.createElement('td');
        const btnView = document.createElement('button');
        btnView.className = 'btn btn-ghost btn-sm';
        btnView.innerHTML = '<i data-lucide="eye" style="width: 14px; height: 14px;"></i>';
        btnView.title = 'Lihat Detail';
        btnView.onclick = () => {
          window.location.hash = `#asset-detail/${item.asset_id}`;
        };
        tdActions.appendChild(btnView);

        tr.appendChild(tdId);
        tr.appendChild(tdName);
        tr.appendChild(tdCategory);
        tr.appendChild(tdLocation);
        tr.appendChild(tdCondition);
        tr.appendChild(tdStatus);
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
      });

      // Pagination rendering
      const totalCount = res.total || res.data.length; // Fallback if backend doesn't send total
      updatePaginationInfo(res.data.length, totalCount, STATE.assetFilters.page);
      
      lucide.createIcons();
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state" style="color: var(--danger);">Gagal memuat data aset.</td></tr>';
  }
}

function updatePaginationInfo(loadedCount, totalCount, currentPage) {
  const infoSpan = document.getElementById('assets-pagination-info');
  const start = totalCount === 0 ? 0 : (currentPage - 1) * STATE.assetFilters.limit + 1;
  const end = Math.min(currentPage * STATE.assetFilters.limit, totalCount);
  
  infoSpan.textContent = `Menampilkan ${start}-${end} dari ${totalCount} data`;
  
  const btnsContainer = document.getElementById('assets-pagination-btns');
  btnsContainer.innerHTML = '';

  const totalPages = Math.ceil(totalCount / STATE.assetFilters.limit);
  
  const btnPrev = document.createElement('button');
  btnPrev.className = 'pagination-btn';
  btnPrev.textContent = 'Sebelumnya';
  btnPrev.disabled = currentPage === 1;
  btnPrev.onclick = () => {
    STATE.assetFilters.page--;
    fetchAssets();
  };
  
  const btnNext = document.createElement('button');
  btnNext.className = 'pagination-btn';
  btnNext.textContent = 'Selanjutnya';
  btnNext.disabled = currentPage >= totalPages || totalPages === 0;
  btnNext.onclick = () => {
    STATE.assetFilters.page++;
    fetchAssets();
  };

  btnsContainer.appendChild(btnPrev);
  
  // Render pages numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.onclick = () => {
        STATE.assetFilters.page = i;
        fetchAssets();
      };
      btnsContainer.appendChild(pageBtn);
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.style.padding = '0 6px';
      btnsContainer.appendChild(dots);
    }
  }

  btnsContainer.appendChild(btnNext);
}

// -------------------------------------------------------------
// 6. View Handlers: Asset Detail
// -------------------------------------------------------------
async function fetchAssetDetail(assetId) {
  try {
    const res = await apiRequest(`/api/v1/assets/${assetId}`);
    if (res.success && res.data) {
      const item = res.data.asset;
      const history = res.data.transactions || [];
      STATE.selectedAsset = item;

      // Update basic fields safely
      document.getElementById('detail-asset-name').textContent = decodeHtml(item.item_name);
      document.getElementById('detail-asset-id').textContent = item.asset_id;
      
      const catOpt = CATEGORY_OPTIONS.find(c => c.id === item.category_id);
      document.getElementById('detail-asset-category').textContent = catOpt ? catOpt.label : item.category_id;
      
      document.getElementById('detail-asset-condition').innerHTML = `<span class="badge badge-${BADGE_VARIANTS[item.condition] || 'default'}">${CONDITION_LABELS[item.condition] || item.condition}</span>`;
      document.getElementById('detail-asset-status').innerHTML = `<span class="badge badge-${BADGE_VARIANTS[item.status] || 'default'}">${STATUS_LABELS[item.status] || item.status}</span>`;
      
      document.getElementById('detail-asset-brand').textContent = item.brand ? decodeHtml(item.brand) : 'Tanpa Merek';
      document.getElementById('detail-asset-serial').textContent = item.serial_number ? decodeHtml(item.serial_number) : 'Tidak ada';
      
      const picOpt = PIC_OPTIONS.find(p => p.id === item.pic_id);
      document.getElementById('detail-asset-pic').textContent = picOpt ? picOpt.label : item.pic_id;
      
      const branchOpt = BRANCH_OPTIONS.find(b => b.id === item.branch_id);
      document.getElementById('detail-asset-branch').textContent = branchOpt ? branchOpt.label : item.branch_id;
      
      const roomOpt = ROOM_OPTIONS.find(r => r.id === item.room_id);
      document.getElementById('detail-asset-room').textContent = roomOpt ? roomOpt.label : item.room_id;
      
      document.getElementById('detail-asset-notes').textContent = item.notes ? decodeHtml(item.notes) : 'Tidak ada catatan tambahan.';

      // QR Image loading
      const qrImg = document.getElementById('detail-qr-img');
      if (item.qr_code_url) {
        qrImg.src = item.qr_code_url;
      } else {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(item.asset_id)}`;
      }

      // QR Regenerate click
      document.getElementById('btn-regenerate-qr').onclick = async () => {
        try {
          showNotice('Meregenerasi QR Code...', 'info');
          const qrRes = await apiRequest('/api/v1/assets/generate-qr', {
            method: 'POST',
            body: { asset_id: item.asset_id }
          });
          if (qrRes.success && qrRes.data.qr_code) {
            qrImg.src = qrRes.data.qr_code;
            showNotice('QR Code berhasil diperbarui!', 'success');
          }
        } catch {}
      };

      // Foto Aset
      const photoImg = document.getElementById('detail-photo-img');
      photoImg.src = item.photo_url || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23cbd5e0" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';

      // Render Admin actions & upload form
      const isAdmin = STATE.user.role === ROLES.SUPER_ADMIN || STATE.user.role === ROLES.BRANCH_ADMIN;
      const adminActionsDiv = document.getElementById('asset-detail-admin-actions');
      adminActionsDiv.innerHTML = '';
      
      const uploadContainer = document.getElementById('photo-upload-container');
      uploadContainer.innerHTML = '';

      if (isAdmin) {
        // Edit button
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-ghost btn-sm';
        btnEdit.style.marginRight = '8px';
        btnEdit.innerHTML = '<i data-lucide="edit"></i> Edit';
        btnEdit.onclick = () => {
          prefillEditForm(item);
          openModal('modal-edit-asset');
        };

        // Delete button
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn btn-danger btn-sm';
        btnDelete.innerHTML = '<i data-lucide="trash-2"></i> Hapus';
        btnDelete.onclick = () => {
          if (confirm(`Apakah Anda yakin ingin menghapus aset ${item.item_name} (${item.asset_id})?`)) {
            deleteAsset(item.asset_id);
          }
        };

        adminActionsDiv.appendChild(btnEdit);
        adminActionsDiv.appendChild(btnDelete);

        // Upload picture input elements securely
        const fileInputWrapper = document.createElement('div');
        fileInputWrapper.className = 'file-input-btn';
        fileInputWrapper.innerHTML = `
          <button class="btn btn-primary btn-sm" style="width: 100%;">
            <i data-lucide="camera"></i> Unggah Foto
          </button>
          <input type="file" id="photo-file-input" accept="image/jpeg,image/png">
        `;
        uploadContainer.appendChild(fileInputWrapper);
        setupPhotoUploadListener(item.asset_id);
      } else {
        uploadContainer.innerHTML = '<span style="font-size: 0.8rem; color: var(--foreground-muted);">Akses unggah foto terbatas untuk admin.</span>';
      }

      // Render History safely
      const histBody = document.getElementById('asset-history-table-body');
      histBody.innerHTML = '';
      
      if (history.length === 0) {
        histBody.innerHTML = '<tr><td colspan="4" class="empty-state">Belum ada riwayat transaksi untuk aset ini.</td></tr>';
      } else {
        history.forEach(h => {
          const tr = document.createElement('tr');
          const tdTime = document.createElement('td');
          tdTime.textContent = formatDate(h.created_at);
          
          const tdTrx = document.createElement('td');
          tdTrx.textContent = TRANSACTION_LABELS[h.trx_type] || h.trx_type;
          
          const tdBy = document.createElement('td');
          tdBy.textContent = h.created_by;
          
          const tdDesc = document.createElement('td');
          tdDesc.textContent = decodeHtml(h.description);
          
          tr.appendChild(tdTime);
          tr.appendChild(tdTrx);
          tr.appendChild(tdBy);
          tr.appendChild(tdDesc);
          histBody.appendChild(tr);
        });
      }

      lucide.createIcons();
    }
  } catch (error) {
    showNotice('Gagal memuat detail aset.', 'error');
  }
}

function setupPhotoUploadListener(assetId) {
  const fileInput = document.getElementById('photo-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Safety checks
    if (file.size > 5 * 1024 * 1024) {
      showNotice('File foto terlalu besar! Batas maksimum adalah 5MB.', 'error');
      return;
    }

    if (!file.type.startsWith('image/')) {
      showNotice('Format file tidak didukung! Pilih file gambar.', 'error');
      return;
    }

    showNotice('Memproses foto...', 'info');

    // Read and compress client-side
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Render image in a hidden canvas to compress/resize
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Compress to JPEG format with 80% quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // Upload photo Base64 to GAS backend
        uploadPhoto(assetId, dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(assetId, base64Image) {
  try {
    showNotice('Mengunggah foto ke Google Drive...', 'info');
    const res = await apiRequest('/api/v1/assets/upload-photo', {
      method: 'POST',
      body: { asset_id: assetId, photo: base64Image }
    });

    if (res.success && res.data.photo_url) {
      showNotice('Foto berhasil diunggah!', 'success');
      document.getElementById('detail-photo-img').src = res.data.photo_url;
      // Refresh details
      fetchAssetDetail(assetId);
    } else {
      showNotice(res.message || 'Gagal mengunggah foto.', 'error');
    }
  } catch (err) {
    showNotice('Unggah foto gagal.', 'error');
  }
}

// Prefill form edit asset
function prefillEditForm(asset) {
  const form = document.getElementById('form-edit-asset');
  form.elements['asset_id'].value = asset.asset_id;
  form.elements['item_name'].value = decodeHtml(asset.item_name);
  form.elements['category_id'].value = asset.category_id;
  form.elements['branch_id'].value = asset.branch_id;
  
  // Fill rooms dropdown for the branch first
  renderRoomsDropdown(form.elements['room_id'], asset.branch_id);
  form.elements['room_id'].value = asset.room_id;
  
  form.elements['pic_id'].value = asset.pic_id;
  form.elements['brand'].value = asset.brand ? decodeHtml(asset.brand) : '';
  form.elements['serial_number'].value = asset.serial_number ? decodeHtml(asset.serial_number) : '';
  form.elements['condition'].value = asset.condition;
  form.elements['status'].value = asset.status;
  form.elements['notes'].value = asset.notes ? decodeHtml(asset.notes) : '';
}

async function deleteAsset(assetId) {
  try {
    showNotice('Menghapus aset...', 'info');
    const res = await apiRequest(`/api/v1/assets/${assetId}`, { method: 'DELETE' });
    if (res.success) {
      showNotice('Aset berhasil dihapus.', 'success');
      window.location.hash = '#assets';
      switchView('assets');
    } else {
      showNotice(res.message || 'Gagal menghapus aset.', 'error');
    }
  } catch {}
}

// -------------------------------------------------------------
// 7. View Handlers: Borrowings
// -------------------------------------------------------------
async function fetchBorrowings() {
  const tbody = document.getElementById('borrowings-table-body');
  renderTableSkeleton(tbody, 8);

  try {
    const res = await apiRequest('/api/v1/borrowings');
    tbody.innerHTML = '';

    if (res.success && res.data) {
      if (res.data.length === 0) {
        tbody.appendChild(createEmptyStateRow(8, 'clipboard-x', 'Log Kosong', 'Tidak ada riwayat peminjaman.'));
        return;
      }

      res.data.forEach(item => {
        const tr = document.createElement('tr');
        
        // ID Pinjam
        const tdId = document.createElement('td');
        tdId.textContent = item.borrow_id;
        tdId.style.fontFamily = 'monospace';
        tdId.style.fontWeight = 'bold';

        // Aset
        const tdAsset = document.createElement('td');
        tdAsset.textContent = `${item.item_name} (${item.asset_id})`;
        tdAsset.style.fontWeight = '600';

        // Peminjam (Guru)
        const tdTeacher = document.createElement('td');
        const picOpt = PIC_OPTIONS.find(p => p.id === item.teacher_id);
        tdTeacher.textContent = picOpt ? picOpt.label : item.teacher_id;

        // Tanggal Pinjam
        const tdDate = document.createElement('td');
        tdDate.textContent = formatDate(item.borrow_date);

        // Target Kembali
        const tdExpected = document.createElement('td');
        tdExpected.textContent = formatDate(item.expected_return_date);

        // Tanggal Kembali
        const tdReturned = document.createElement('td');
        tdReturned.textContent = item.return_date ? formatDate(item.return_date) : '-';

        // Status Badge
        const tdStatus = document.createElement('td');
        const statusLabel = STATUS_LABELS[item.status] || item.status;
        const statusVariant = BADGE_VARIANTS[item.status] || 'default';
        tdStatus.innerHTML = `<span class="badge badge-${statusVariant}">${statusLabel}</span>`;

        // Action Return
        const tdAction = document.createElement('td');
        if (item.status === 'BORROWED') {
          const btnReturn = document.createElement('button');
          btnReturn.className = 'btn btn-secondary btn-sm';
          btnReturn.innerHTML = '<i data-lucide="check" style="width: 12px; height: 12px; margin-right: 4px;"></i> Kembalikan';
          btnReturn.onclick = () => {
            prefillReturnForm(item);
            openModal('modal-return-asset');
          };
          tdAction.appendChild(btnReturn);
        } else {
          tdAction.innerHTML = '<span style="color: var(--foreground-muted); font-size: 0.8rem;">Selesai</span>';
        }

        tr.appendChild(tdId);
        tr.appendChild(tdAsset);
        tr.appendChild(tdTeacher);
        tr.appendChild(tdDate);
        tr.appendChild(tdExpected);
        tr.appendChild(tdReturned);
        tr.appendChild(tdStatus);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });
      
      lucide.createIcons();
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="color: var(--danger);">Gagal memuat log peminjaman.</td></tr>';
  }
}

function prefillReturnForm(borrowItem) {
  const form = document.getElementById('form-return-asset');
  form.elements['borrow_id'].value = borrowItem.borrow_id;
  form.elements['asset_id'].value = borrowItem.asset_id;
  document.getElementById('return-asset-name').value = `${borrowItem.item_name} (${borrowItem.asset_id})`;
  
  const picOpt = PIC_OPTIONS.find(p => p.id === borrowItem.teacher_id);
  document.getElementById('return-borrower-name').value = picOpt ? picOpt.label : borrowItem.teacher_id;
}

// -------------------------------------------------------------
// 8. View Handlers: Maintenance (Tickets)
// -------------------------------------------------------------
async function fetchMaintenances() {
  const tbody = document.getElementById('maintenance-table-body');
  renderTableSkeleton(tbody, 8);

  try {
    const res = await apiRequest('/api/v1/maintenances');
    tbody.innerHTML = '';

    if (res.success && res.data) {
      if (res.data.length === 0) {
        tbody.appendChild(createEmptyStateRow(8, 'wrench', 'Tidak Ada Tiket', 'Belum ada tiket perbaikan terdaftar.'));
        return;
      }

      res.data.forEach(item => {
        const tr = document.createElement('tr');
        
        // ID Tiket
        const tdId = document.createElement('td');
        tdId.textContent = item.maintenance_id;
        tdId.style.fontFamily = 'monospace';
        tdId.style.fontWeight = 'bold';

        // Aset
        const tdAsset = document.createElement('td');
        tdAsset.textContent = `${item.item_name} (${item.asset_id})`;
        tdAsset.style.fontWeight = '600';

        // Masalah
        const tdIssue = document.createElement('td');
        tdIssue.textContent = decodeHtml(item.issue_description);

        // Status
        const tdStatus = document.createElement('td');
        const statusLabel = STATUS_LABELS[item.status] || item.status;
        const statusVariant = BADGE_VARIANTS[item.status] || 'default';
        tdStatus.innerHTML = `<span class="badge badge-${statusVariant}">${statusLabel}</span>`;

        // Petugas (PIC)
        const tdPIC = document.createElement('td');
        const picOpt = PIC_OPTIONS.find(p => p.id === item.pic_id);
        tdPIC.textContent = picOpt ? picOpt.label : item.pic_id;

        // Tanggal Masuk
        const tdStart = document.createElement('td');
        tdStart.textContent = formatDate(item.start_date);

        // Tanggal Selesai
        const tdEnd = document.createElement('td');
        tdEnd.textContent = item.end_date ? formatDate(item.end_date) : '-';

        // Aksi Selesaikan
        const tdAction = document.createElement('td');
        if (item.status === 'PENDING' || item.status === 'IN_PROGRESS') {
          const btnResolve = document.createElement('button');
          btnResolve.className = 'btn btn-primary btn-sm';
          btnResolve.innerHTML = '<i data-lucide="check" style="width: 12px; height: 12px;"></i> Selesai';
          btnResolve.onclick = () => {
            prefillResolveForm(item);
            openModal('modal-resolve-maintenance');
          };
          tdAction.appendChild(btnResolve);
        } else {
          tdAction.innerHTML = '<span style="color: var(--foreground-muted); font-size: 0.8rem;">Diselesaikan</span>';
        }

        tr.appendChild(tdId);
        tr.appendChild(tdAsset);
        tr.appendChild(tdIssue);
        tr.appendChild(tdStatus);
        tr.appendChild(tdPIC);
        tr.appendChild(tdStart);
        tr.appendChild(tdEnd);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });

      lucide.createIcons();
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="color: var(--danger);">Gagal memuat log perbaikan.</td></tr>';
  }
}

function prefillResolveForm(mItem) {
  const form = document.getElementById('form-resolve-maintenance');
  form.elements['maintenance_id'].value = mItem.maintenance_id;
  document.getElementById('resolve-asset-name').value = `${mItem.item_name} (${mItem.asset_id})`;
  document.getElementById('resolve-issue-desc').textContent = decodeHtml(mItem.issue_description);
}

// -------------------------------------------------------------
// 9. View Handlers: Inspections (Audit)
// -------------------------------------------------------------
async function fetchInspections() {
  const tbody = document.getElementById('inspections-table-body');
  renderTableSkeleton(tbody, 6);

  try {
    const res = await apiRequest('/api/v1/inspections');
    tbody.innerHTML = '';

    if (res.success && res.data) {
      if (res.data.length === 0) {
        tbody.appendChild(createEmptyStateRow(6, 'check-square', 'Audit Kosong', 'Belum ada log inspeksi fisik.'));
        return;
      }

      res.data.forEach(item => {
        const tr = document.createElement('tr');
        
        // ID Audit
        const tdId = document.createElement('td');
        tdId.textContent = item.inspection_id;
        tdId.style.fontFamily = 'monospace';
        tdId.style.fontWeight = 'bold';

        // Aset
        const tdAsset = document.createElement('td');
        tdAsset.textContent = `${item.item_name} (${item.asset_id})`;
        tdAsset.style.fontWeight = '600';

        // Kondisi Temuan
        const tdCondition = document.createElement('td');
        const condLabel = CONDITION_LABELS[item.condition] || item.condition;
        const condVariant = BADGE_VARIANTS[item.condition] || 'default';
        tdCondition.innerHTML = `<span class="badge badge-${condVariant}">${condLabel}</span>`;

        // Tanggal Audit
        const tdDate = document.createElement('td');
        tdDate.textContent = formatDate(item.inspection_date);

        // Auditor (User)
        const tdAuditor = document.createElement('td');
        const picOpt = PIC_OPTIONS.find(p => p.id === item.inspected_by);
        tdAuditor.textContent = picOpt ? picOpt.label : item.inspected_by;

        // Catatan
        const tdNotes = document.createElement('td');
        tdNotes.textContent = decodeHtml(item.notes);

        tr.appendChild(tdId);
        tr.appendChild(tdAsset);
        tr.appendChild(tdCondition);
        tr.appendChild(tdDate);
        tr.appendChild(tdAuditor);
        tr.appendChild(tdNotes);
        tbody.appendChild(tr);
      });

      lucide.createIcons();
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="color: var(--danger);">Gagal memuat log inspeksi.</td></tr>';
  }
}

// -------------------------------------------------------------
// 10. View Handlers: Transfers (Mutations)
// -------------------------------------------------------------
async function fetchTransfers() {
  const tbody = document.getElementById('transfers-table-body');
  renderTableSkeleton(tbody, 7);

  try {
    const res = await apiRequest('/api/v1/transfers');
    tbody.innerHTML = '';

    if (res.success && res.data) {
      if (res.data.length === 0) {
        tbody.appendChild(createEmptyStateRow(7, 'shuffle', 'Transfer Kosong', 'Tidak ada log perpindahan aset.'));
        return;
      }

      res.data.forEach(item => {
        const tr = document.createElement('tr');
        
        // ID Mutasi
        const tdId = document.createElement('td');
        tdId.textContent = item.transfer_id;
        tdId.style.fontFamily = 'monospace';
        tdId.style.fontWeight = 'bold';

        // Aset
        const tdAsset = document.createElement('td');
        tdAsset.textContent = `${item.item_name} (${item.asset_id})`;
        tdAsset.style.fontWeight = '600';

        // Cabang Asal
        const tdFrom = document.createElement('td');
        const fromBranch = BRANCH_OPTIONS.find(b => b.id === item.from_branch_id);
        const fromRoom = ROOM_OPTIONS.find(r => r.id === item.from_room_id);
        tdFrom.textContent = `${fromBranch ? fromBranch.label : item.from_branch_id} — ${fromRoom ? fromRoom.label : item.from_room_id}`;

        // Tujuan Transfer
        const tdTo = document.createElement('td');
        const toBranch = BRANCH_OPTIONS.find(b => b.id === item.to_branch_id);
        const toRoom = ROOM_OPTIONS.find(r => r.id === item.to_room_id);
        tdTo.textContent = `${toBranch ? toBranch.label : item.to_branch_id} — ${toRoom ? toRoom.label : item.to_room_id}`;

        // Tanggal
        const tdDate = document.createElement('td');
        tdDate.textContent = formatDate(item.transfer_date);

        // Oleh
        const tdOleh = document.createElement('td');
        const picOpt = PIC_OPTIONS.find(p => p.id === item.transferred_by);
        tdOleh.textContent = picOpt ? picOpt.label : item.transferred_by;

        // Notes
        const tdNotes = document.createElement('td');
        tdNotes.textContent = decodeHtml(item.notes);

        tr.appendChild(tdId);
        tr.appendChild(tdAsset);
        tr.appendChild(tdFrom);
        tr.appendChild(tdTo);
        tr.appendChild(tdDate);
        tr.appendChild(tdOleh);
        tr.appendChild(tdNotes);
        tbody.appendChild(tr);
      });

      lucide.createIcons();
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state" style="color: var(--danger);">Gagal memuat log mutasi.</td></tr>';
  }
}

// -------------------------------------------------------------
// 11. View Handlers: Reports
// -------------------------------------------------------------
function initReportsDropdowns() {
  const branchSelect = document.getElementById('report-filter-branch');
  renderBranchesDropdown(branchSelect);
  
  // Set default dates
  const today = new Date().toISOString().substring(0, 10);
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const oneMonthAgoStr = oneMonthAgo.toISOString().substring(0, 10);
  
  document.getElementById('report-filter-start-date').value = oneMonthAgoStr;
  document.getElementById('report-filter-end-date').value = today;
}

async function generateReport() {
  const activeReportCard = document.querySelector('.report-type-card.active');
  if (!activeReportCard) return;

  const reportType = activeReportCard.getAttribute('data-report');
  const branchId = document.getElementById('report-filter-branch').value;
  const startDate = document.getElementById('report-filter-start-date').value;
  const endDate = document.getElementById('report-filter-end-date').value;

  const previewContainer = document.getElementById('report-preview-container');
  previewContainer.innerHTML = '<div class="card empty-state">Memproses laporan...</div>';
  document.getElementById('btn-print-report').disabled = true;

  try {
    const params = {
      branch_id: branchId || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined
    };

    let endpoint = `/api/v1/reports/assets`;
    if (reportType === 'borrowings') endpoint = `/api/v1/reports/borrowings`;
    else if (reportType === 'maintenances') endpoint = `/api/v1/reports/maintenances`;
    else if (reportType === 'opname') endpoint = `/api/v1/reports/opname`;

    const res = await apiRequest(endpoint, { params });
    previewContainer.innerHTML = ''; // Clear loading

    if (res.success && res.data) {
      renderReportPreview(reportType, res.data, params);
      document.getElementById('btn-print-report').disabled = false;
    } else {
      previewContainer.innerHTML = `<div class="card empty-state" style="color: var(--danger);">${res.message || 'Gagal memuat laporan.'}</div>`;
    }
  } catch (error) {
    previewContainer.innerHTML = '<div class="card empty-state" style="color: var(--danger);">Koneksi API gagal memproses laporan.</div>';
  }
}

function renderReportPreview(type, data, filters) {
  const container = document.getElementById('report-preview-container');
  const printArea = document.getElementById('print-area');
  
  // Clean structure
  const card = document.createElement('div');
  card.className = 'card';
  card.style.overflowX = 'auto';

  // Build Print structure
  printArea.innerHTML = '';
  
  let title = 'Laporan Inventaris Aset Sekolah';
  let headers = ['ID Aset', 'Nama Barang', 'Kategori', 'Cabang', 'Kondisi', 'Status'];
  let rowRenderer = () => '';

  if (type === 'assets') {
    title = 'Laporan Inventaris Aset Sekolah';
    headers = ['ID Aset', 'Nama Barang', 'Kategori', 'Merek', 'Lokasi', 'Kondisi', 'Status'];
    rowRenderer = (item) => `
      <tr>
        <td>${item.asset_id}</td>
        <td><strong>${decodeHtml(item.item_name)}</strong></td>
        <td>${CATEGORY_OPTIONS.find(c => c.id === item.category_id)?.label || item.category_id}</td>
        <td>${item.brand ? decodeHtml(item.brand) : '-'}</td>
        <td>${BRANCH_OPTIONS.find(b => b.id === item.branch_id)?.label || item.branch_id} — ${ROOM_OPTIONS.find(r => r.id === item.room_id)?.label || item.room_id}</td>
        <td>${CONDITION_LABELS[item.condition] || item.condition}</td>
        <td>${STATUS_LABELS[item.status] || item.status}</td>
      </tr>
    `;
  } else if (type === 'borrowings') {
    title = 'Laporan Peminjaman Aset Sekolah';
    headers = ['ID Pinjam', 'Nama Aset (ID)', 'Peminjam', 'Tgl Pinjam', 'Tgl Target', 'Tgl Kembali', 'Status'];
    rowRenderer = (item) => `
      <tr>
        <td>${item.borrow_id}</td>
        <td>${decodeHtml(item.item_name)} (${item.asset_id})</td>
        <td>${PIC_OPTIONS.find(p => p.id === item.teacher_id)?.label || item.teacher_id}</td>
        <td>${formatDate(item.borrow_date)}</td>
        <td>${formatDate(item.expected_return_date)}</td>
        <td>${item.return_date ? formatDate(item.return_date) : '-'}</td>
        <td>${STATUS_LABELS[item.status] || item.status}</td>
      </tr>
    `;
  } else if (type === 'maintenances') {
    title = 'Laporan Perbaikan & Pemeliharaan Aset';
    headers = ['ID Tiket', 'Nama Aset (ID)', 'Masalah Terlapor', 'Status', 'Tgl Masuk', 'Tgl Selesai', 'Resolusi'];
    rowRenderer = (item) => `
      <tr>
        <td>${item.maintenance_id}</td>
        <td>${decodeHtml(item.item_name)} (${item.asset_id})</td>
        <td>${decodeHtml(item.issue_description)}</td>
        <td>${STATUS_LABELS[item.status] || item.status}</td>
        <td>${formatDate(item.start_date)}</td>
        <td>${item.end_date ? formatDate(item.end_date) : '-'}</td>
        <td>${item.resolution_notes ? decodeHtml(item.resolution_notes) : '-'}</td>
      </tr>
    `;
  } else if (type === 'opname') {
    title = 'Laporan Opname / Inspeksi Fisik Aset';
    headers = ['ID Audit', 'Nama Aset (ID)', 'Kondisi Temuan', 'Tgl Inspeksi', 'Auditor', 'Catatan Temuan'];
    rowRenderer = (item) => `
      <tr>
        <td>${item.inspection_id}</td>
        <td>${decodeHtml(item.item_name)} (${item.asset_id})</td>
        <td>${CONDITION_LABELS[item.condition] || item.condition}</td>
        <td>${formatDate(item.inspection_date)}</td>
        <td>${PIC_OPTIONS.find(p => p.id === item.inspected_by)?.label || item.inspected_by}</td>
        <td>${decodeHtml(item.notes)}</td>
      </tr>
    `;
  }

  // Create HTML table
  let tableHtml = `
    <table class="print-table">
      <thead>
        <tr>
          ${headers.map(h => `<th>${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${data.length === 0 ? `<tr><td colspan="${headers.length}" style="text-align: center;">Tidak ada data laporan ditemukan.</td></tr>` : data.map(item => rowRenderer(item)).join('')}
      </tbody>
    </table>
  `;

  // 1. Render Screen Preview
  const previewHeader = document.createElement('h3');
  previewHeader.textContent = 'Preview Laporan';
  previewHeader.style.marginBottom = 'var(--spacing-md)';
  
  card.innerHTML = tableHtml;
  // Alter CSS class for screen preview styling
  card.querySelector('table').className = 'data-table';
  
  container.appendChild(previewHeader);
  container.appendChild(card);

  // 2. Render Print Layout (hidden on screen, prints on @media print)
  const branchName = filters.branch_id ? (BRANCH_OPTIONS.find(b => b.id === filters.branch_id)?.label || filters.branch_id) : 'Seluruh Cabang';
  const startStr = filters.start_date ? formatDate(filters.start_date) : 'Awal';
  const endStr = filters.end_date ? formatDate(filters.end_date) : 'Akhir';

  printArea.innerHTML = `
    <div class="print-header">
      <div class="print-logo">SISMA INVENTARIS</div>
      <h2>${title}</h2>
      <p>Sistem Inventaris Manajemen Aset Sekolah Aman</p>
    </div>
    
    <div class="print-metadata">
      <div>
        <p><strong>Cakupan Cabang:</strong> ${branchName}</p>
        <p><strong>Periode Laporan:</strong> ${startStr} s/d ${endStr}</p>
      </div>
      <div style="text-align: right;">
        <p><strong>Dicetak Oleh:</strong> ${STATE.user.name}</p>
        <p><strong>Tanggal Cetak:</strong> ${formatDate(new Date())}</p>
      </div>
    </div>
    
    ${tableHtml}
    
    <div class="print-signatures">
      <div class="signature-block">
        <p>Mengetahui,</p>
        <p>Kepala Sekolah / Cabang</p>
        <div class="signature-line">(...................................................)</div>
      </div>
      <div class="signature-block">
        <p>Dipersiapkan Oleh,</p>
        <p>Petugas Inventaris (PIC)</p>
        <div class="signature-line">${STATE.user.name}</div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// 12. View Handlers: Forms Submission Operations
// -------------------------------------------------------------
async function handleAddAssetSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-add-asset');
  
  const payload = {
    item_name: form.elements['item_name'].value.trim(),
    category_id: form.elements['category_id'].value,
    branch_id: form.elements['branch_id'].value,
    room_id: form.elements['room_id'].value,
    pic_id: form.elements['pic_id'].value,
    brand: form.elements['brand'].value.trim(),
    serial_number: form.elements['serial_number'].value.trim(),
    notes: form.elements['notes'].value.trim()
  };

  if (!payload.item_name || !payload.category_id || !payload.branch_id || !payload.room_id || !payload.pic_id) {
    showNotice('Mohon lengkapi seluruh kolom bertanda bintang (*)', 'warning');
    return;
  }

  try {
    toggleFormSubmitting(submitBtn, true, 'Menyimpan...');
    const res = await apiRequest('/api/v1/assets', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      showNotice('Aset baru berhasil ditambahkan!', 'success');
      closeAllModals();
      form.reset();
      fetchAssets();
    } else {
      showNotice(res.message || 'Gagal menambahkan aset.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Simpan Aset');
  }
}

async function handleEditAssetSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-edit-asset');
  const assetId = form.elements['asset_id'].value;

  const payload = {
    item_name: form.elements['item_name'].value.trim(),
    category_id: form.elements['category_id'].value,
    branch_id: form.elements['branch_id'].value,
    room_id: form.elements['room_id'].value,
    pic_id: form.elements['pic_id'].value,
    brand: form.elements['brand'].value.trim(),
    serial_number: form.elements['serial_number'].value.trim(),
    condition: form.elements['condition'].value,
    status: form.elements['status'].value,
    notes: form.elements['notes'].value.trim()
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Menyimpan...');
    const res = await apiRequest(`/api/v1/assets/${assetId}`, {
      method: 'PUT',
      body: payload
    });

    if (res.success) {
      showNotice('Perubahan aset berhasil disimpan!', 'success');
      closeAllModals();
      fetchAssetDetail(assetId); // Refresh details view
    } else {
      showNotice(res.message || 'Gagal menyimpan perubahan.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Simpan Perubahan');
  }
}

async function handleNewBorrowingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-borrowing');

  const payload = {
    asset_id: form.elements['asset_id'].value,
    teacher_id: form.elements['teacher_id'].value,
    expected_return_date: form.elements['expected_return_date'].value,
    notes: form.elements['notes'].value.trim()
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Memproses...');
    const res = await apiRequest('/api/v1/borrowings', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      showNotice('Peminjaman aset berhasil diproses!', 'success');
      closeAllModals();
      form.reset();
      fetchBorrowings();
    } else {
      showNotice(res.message || 'Gagal memproses peminjaman.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Proses Pinjam');
  }
}

async function handleReturnAssetSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-return');

  const payload = {
    borrow_id: form.elements['borrow_id'].value,
    asset_id: form.elements['asset_id'].value,
    condition: form.elements['condition'].value,
    notes: form.elements['notes'].value.trim()
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Memproses...');
    const res = await apiRequest('/api/v1/borrowings/return', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      showNotice('Aset berhasil dikembalikan!', 'success');
      closeAllModals();
      form.reset();
      fetchBorrowings();
    } else {
      showNotice(res.message || 'Gagal mengembalikan aset.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Kembalikan');
  }
}

async function handleNewMaintenanceSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-maintenance');

  const payload = {
    asset_id: form.elements['asset_id'].value,
    issue_description: form.elements['issue_description'].value.trim()
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Memproses...');
    const res = await apiRequest('/api/v1/maintenances', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      showNotice('Tiket perbaikan berhasil dibuka!', 'success');
      closeAllModals();
      form.reset();
      fetchMaintenances();
    } else {
      showNotice(res.message || 'Gagal membuka tiket perbaikan.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Buka Tiket');
  }
}

async function handleResolveMaintenanceSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-resolve');
  const mId = form.elements['maintenance_id'].value;

  const payload = {
    resolution_notes: form.elements['resolution_notes'].value.trim(),
    status: 'COMPLETED'
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Memproses...');
    const res = await apiRequest(`/api/v1/maintenances/${mId}`, {
      method: 'PUT',
      body: payload
    });

    if (res.success) {
      showNotice('Tiket perbaikan telah diselesaikan!', 'success');
      closeAllModals();
      form.reset();
      fetchMaintenances();
    } else {
      showNotice(res.message || 'Gagal menyelesaikan perbaikan.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Selesaikan');
  }
}

async function handleNewInspectionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-inspection');

  const payload = {
    asset_id: form.elements['asset_id'].value,
    condition: form.elements['condition'].value,
    notes: form.elements['notes'].value.trim()
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Memproses...');
    const res = await apiRequest('/api/v1/inspections', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      showNotice('Audit inspeksi fisik berhasil direkam!', 'success');
      closeAllModals();
      form.reset();
      fetchInspections();
    } else {
      showNotice(res.message || 'Gagal merekam inspeksi.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Rekam Audit');
  }
}

async function handleNewTransferSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('btn-save-transfer');

  const payload = {
    asset_id: form.elements['asset_id'].value,
    target_branch_id: form.elements['target_branch_id'].value,
    target_room_id: form.elements['target_room_id'].value,
    notes: form.elements['notes'].value.trim()
  };

  try {
    toggleFormSubmitting(submitBtn, true, 'Memproses...');
    const res = await apiRequest('/api/v1/transfers', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      showNotice('Mutasi transfer aset berhasil diproses!', 'success');
      closeAllModals();
      form.reset();
      fetchTransfers();
    } else {
      showNotice(res.message || 'Gagal memproses transfer.', 'error');
    }
  } catch (err) {
  } finally {
    toggleFormSubmitting(submitBtn, false, 'Transfer Aset');
  }
}

// -------------------------------------------------------------
// 13. DOM / Dropdown Builders
// -------------------------------------------------------------
function renderAuthenticatedState() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('dashboard-layout').classList.remove('hidden');
  
  // Render profile metadata
  document.getElementById('user-display-name').textContent = STATE.user.name;
  document.getElementById('user-display-role').textContent = ROLE_LABELS[STATE.user.role] || STATE.user.role;

  // Manage permissions
  const isAdmin = STATE.user.role === ROLES.SUPER_ADMIN || STATE.user.role === ROLES.BRANCH_ADMIN;
  document.getElementById('btn-add-asset-modal').disabled = !isAdmin;

  // Manage sidebar active tabs based on RBAC roles
  document.querySelectorAll('.sidebar-item').forEach(item => {
    const view = item.getAttribute('data-view');
    const isRestrictedView = ['maintenance', 'inspections', 'transfers'].includes(view);
    
    if (isRestrictedView && !isAdmin) {
      item.classList.add('hidden');
    } else {
      item.classList.remove('hidden');
    }
  });

  // Setup modal drop-down values
  bootstrapModalsDropdowns();
}

function renderLoginState() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('dashboard-layout').classList.add('hidden');
  
  // Initialize Google Identity Services
  if (STATE.googleClientId) {
    initializeGoogleSignIn();
  }
}

function bootstrapModalsDropdowns() {
  // Add Asset Form Dropdowns
  const formAdd = document.getElementById('form-add-asset');
  renderCategoriesDropdown(formAdd.elements['category_id']);
  renderBranchesDropdown(formAdd.elements['branch_id']);
  renderUsersDropdown(formAdd.elements['pic_id']);

  // Edit Asset Form Dropdowns
  const formEdit = document.getElementById('form-edit-asset');
  renderCategoriesDropdown(formEdit.elements['category_id']);
  renderBranchesDropdown(formEdit.elements['branch_id']);
  renderUsersDropdown(formEdit.elements['pic_id']);

  // Search filter options
  const filterCat = document.getElementById('asset-filter-category');
  renderCategoriesDropdown(filterCat);

  // New Borrowing dropdowns
  renderTeachersDropdown(document.getElementById('borrow-teacher-select'));
  
  // New Transfer dropdowns
  const formTransfer = document.getElementById('form-new-transfer');
  renderBranchesDropdown(formTransfer.elements['target_branch_id']);
}

function renderCategoriesDropdown(selectEl) {
  // Clear non-placeholder options
  while(selectEl.options.length > 1) selectEl.remove(1);
  CATEGORY_OPTIONS.forEach(opt => {
    const op = new Option(opt.label, opt.id);
    selectEl.add(op);
  });
}

function renderBranchesDropdown(selectEl) {
  while(selectEl.options.length > 1) selectEl.remove(1);
  
  // Scoping check: if BRANCH_ADMIN or TEACHER, they can only select their own branch
  let scopedBranches = BRANCH_OPTIONS;
  if (STATE.user && STATE.user.role !== ROLES.SUPER_ADMIN) {
    scopedBranches = BRANCH_OPTIONS.filter(b => b.id === STATE.user.branch_id);
  }

  scopedBranches.forEach(opt => {
    const op = new Option(opt.label, opt.id);
    selectEl.add(op);
  });
}

function renderRoomsDropdown(selectEl, branchId) {
  // Rooms can be mapped dynamically to branch
  selectEl.innerHTML = '<option value="">Pilih Ruangan</option>';
  if (!branchId) return;

  // Render mock rooms
  ROOM_OPTIONS.forEach(opt => {
    const op = new Option(opt.label, opt.id);
    selectEl.add(op);
  });
}

function renderUsersDropdown(selectEl) {
  while(selectEl.options.length > 1) selectEl.remove(1);
  PIC_OPTIONS.forEach(opt => {
    const op = new Option(opt.label, opt.id);
    selectEl.add(op);
  });
}

function renderTeachersDropdown(selectEl) {
  while(selectEl.options.length > 1) selectEl.remove(1);
  // Teachers list
  PIC_OPTIONS.forEach(opt => {
    const op = new Option(opt.label, opt.id);
    selectEl.add(op);
  });
}

async function renderAssetsDropdown(selectEl, filters = {}) {
  selectEl.innerHTML = '<option value="">Memuat aset...</option>';
  try {
    const params = { limit: 100, ...filters };
    const res = await apiRequest('/api/v1/assets', { params });
    selectEl.innerHTML = '<option value="">Pilih Aset</option>';
    
    if (res.success && res.data) {
      res.data.forEach(asset => {
        const optionText = `${decodeHtml(asset.item_name)} (${asset.asset_id}) - ${STATUS_LABELS[asset.status] || asset.status}`;
        const op = new Option(optionText, asset.asset_id);
        selectEl.add(op);
      });
    }
  } catch (err) {
    selectEl.innerHTML = '<option value="">Gagal memuat daftar aset</option>';
  }
}

// -------------------------------------------------------------
// 14. HTML Escape Helpers & UI Decorators
// -------------------------------------------------------------
function decodeHtml(html) {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

function formatDate(isoString) {
  if (!isoString) return '-';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

function toggleFormSubmitting(buttonEl, isSubmitting, text) {
  buttonEl.disabled = isSubmitting;
  if (isSubmitting) {
    buttonEl.setAttribute('data-orig-text', buttonEl.textContent);
    buttonEl.textContent = text;
  } else {
    buttonEl.textContent = buttonEl.getAttribute('data-orig-text') || buttonEl.textContent;
  }
}

function renderTableSkeleton(tbody, colsCount) {
  tbody.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const tr = document.createElement('tr');
    tr.className = 'skeleton-row';
    for (let j = 0; j < colsCount; j++) {
      const td = document.createElement('td');
      td.innerHTML = '<div class="skeleton-bar"></div>';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function createEmptyState(iconName, title, desc) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <i data-lucide="${iconName}" style="width: 48px; height: 48px;"></i>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-desc">${desc}</div>
  `;
  return div;
}

function createEmptyStateRow(colspan, iconName, title, desc) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.appendChild(createEmptyState(iconName, title, desc));
  tr.appendChild(td);
  return tr;
}

// Toast Notices
function showNotice(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  else if (type === 'error') iconName = 'x-circle';
  else if (type === 'warning') iconName = 'alert-triangle';

  toast.innerHTML = `
    <div class="toast-icon"><i data-lucide="${iconName}" style="width: 18px; height: 18px;"></i></div>
    <div class="toast-message">${message}</div>
    <button class="toast-close">&times;</button>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();

  // Auto remove toast
  const removeTimeout = setTimeout(() => {
    toast.style.animation = 'none'; // reset animation
    toast.offsetHeight; // trigger reflow
    toast.style.animation = 'toast-in 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);

  // Manual close
  toast.querySelector('.toast-close').onclick = () => {
    clearTimeout(removeTimeout);
    toast.remove();
  };
}

// Modal Utilities
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // prevent back scroll
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
  document.body.style.overflow = '';
}

// Theme Handlers
function initTheme() {
  const cachedTheme = localStorage.getItem('sisma_theme') || 'light';
  STATE.theme = cachedTheme;
  document.documentElement.setAttribute('data-theme', cachedTheme);
  updateThemeIcon();
}

function toggleTheme() {
  const newTheme = STATE.theme === 'light' ? 'dark' : 'light';
  STATE.theme = newTheme;
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('sisma_theme', newTheme);
  updateThemeIcon();
  
  // Re-draw charts with theme variables
  if (STATE.cachedStats && STATE.activeView === 'dashboard') {
    renderDashboardCharts(STATE.cachedStats);
  }
}

function updateThemeIcon() {
  const themeIcon = document.getElementById('theme-icon');
  if (STATE.theme === 'dark') {
    themeIcon.setAttribute('data-lucide', 'sun');
  } else {
    themeIcon.setAttribute('data-lucide', 'moon');
  }
  lucide.createIcons();
}

function getCSSVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// -------------------------------------------------------------
// 15. Dynamic Configuration Settings UI (floating bar for local setup)
// -------------------------------------------------------------
function setupConfigUI() {
  // If configuration is empty, inject a clean setup card into the DOM dynamically
  const isConfigured = STATE.apiBaseUrl && STATE.googleClientId;
  
  if (!isConfigured) {
    const setupOverlay = document.createElement('div');
    setupOverlay.id = 'setup-config-overlay';
    setupOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
      z-index: 9999; display: flex; align-items: center; justify-content: center;
      padding: var(--spacing-md);
    `;

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'width: 100%; max-width: 480px; box-shadow: var(--shadow-4); background-color: var(--surface);';
    card.innerHTML = `
      <h3 style="margin-bottom: var(--spacing-xs);"><i data-lucide="settings" style="vertical-align: middle; margin-right: 8px;"></i>Konfigurasi Awal SISMA</h3>
      <p style="font-size: 0.8rem; color: var(--foreground-muted); margin-bottom: var(--spacing-md);">
        Sebelum menjalankan aplikasi, silakan hubungkan dengan URL Web App Google Apps Script dan Google Client ID Anda.
      </p>
      <form id="setup-config-form">
        <div class="form-group">
          <label class="form-label">Google Apps Script Web App URL *</label>
          <input type="url" id="setup-api-url" class="form-control" placeholder="https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec" required>
        </div>
        <div class="form-group">
          <label class="form-label">Google OAuth Client ID *</label>
          <input type="text" id="setup-client-id" class="form-control" placeholder="123456-abcdef.apps.googleusercontent.com" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: var(--spacing-sm);">
          Simpan & Hubungkan
        </button>
      </form>
    `;

    setupOverlay.appendChild(card);
    document.body.appendChild(setupOverlay);
    lucide.createIcons();

    // Fill inputs with whatever is in state
    document.getElementById('setup-api-url').value = STATE.apiBaseUrl;
    document.getElementById('setup-client-id').value = STATE.googleClientId;

    document.getElementById('setup-config-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const apiUrl = document.getElementById('setup-api-url').value.trim();
      const clientId = document.getElementById('setup-client-id').value.trim();

      if (apiUrl && clientId) {
        localStorage.setItem('sisma_api_url', apiUrl);
        localStorage.setItem('sisma_google_client_id', clientId);
        
        STATE.apiBaseUrl = apiUrl;
        STATE.googleClientId = clientId;
        
        setupOverlay.remove();
        showNotice('Konfigurasi berhasil disimpan. Halaman dimuat ulang...', 'success');
        
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    });
  } else {
    // Show security alert banner if raw email logins are allowed on the backend
    apiRequest('/api/v1/auth/me')
      .then(() => {
        // Verify dev bypass setting status in script properties
        // We show alert in the HTML if ALLOW_DEV_EMAIL_LOGIN = true
        document.getElementById('security-alert-banner').classList.remove('hidden');
      })
      .catch(() => {});
  }
}

// Google OAuth Initializer
function initializeGoogleSignIn() {
  try {
    google.accounts.id.initialize({
      client_id: STATE.googleClientId,
      callback: handleCredentialResponse
    });
    
    google.accounts.id.renderButton(
      document.getElementById("gsi-button"),
      { theme: "outline", size: "large", width: 280 }
    );
  } catch (err) {
    console.error('Failed to initialize Google Sign In:', err);
    showNotice('Gagal inisialisasi modul Google Sign-In.', 'error');
  }
}
