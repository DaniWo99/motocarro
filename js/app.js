/**
 * CONTROLADOR PRINCIPAL DE MI MOTOCARRO
 * Conecta UI, IndexedDB, Sincronización Supabase, Motor Financiero y Gráficos.
 */

import {
  DEFAULT_SETTINGS,
  EXPENSE_CATEGORIES,
  DAY_NAMES_SHORT,
  MONTH_NAMES,
  formatCOP,
  formatShortK,
  getBogotaNow,
  getTodayUnlockStatus,
  formatDateStr,
  formatDateHuman,
  formatDateTimeHuman,
  isScheduledWorkDay,
  generateId,
  escapeHtml,
  downloadTextFile,
  toCSV
} from './utils.js';

import {
  openDB,
  getAll,
  putOne,
  getMeta,
  setMeta,
  enqueueSync,
  getSyncQueue,
  getConflicts,
  exportFullBackup,
  restoreFromBackup
} from './db.js';

import {
  getCloudConfig,
  saveCloudConfig,
  getStorageMode,
  setStorageMode,
  getSession,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  syncWithCloud
} from './sync.js';

import { computeFinancialOverview, buildUnifiedHistory } from './finance.js';
import { drawBarChart, drawComparisonChart } from './charts.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  income: 'Ingresos diarios',
  loan: 'Préstamo Rappi',
  expenses: 'Gastos y utilidad',
  stats: 'Estadísticas y proyecciones',
  history: 'Historial y datos',
  settings: 'Ajustes'
};

const state = {
  view: 'dashboard',
  loanTab: 'original',
  incomes: [],
  expenses: [],
  loanPayments: [],
  settings: { ...DEFAULT_SETTINGS },
  overview: null,
  calYear: getBogotaNow().year,
  calMonth: getBogotaNow().month,
  isSignupMode: false,
  syncStatus: 'idle',
  syncing: false
};

const $ = (id) => document.getElementById(id);

/* ===================== INICIALIZACIÓN ===================== */
async function init() {
  await openDB();
  registerServiceWorker();
  bindGlobalEvents();
  populateStaticSelects();

  const mode = await getStorageMode();
  const session = await getSession();

  if (mode === 'local' || (mode === 'cloud' && session?.access_token)) {
    await enterApp();
  } else {
    await showAuthScreen();
  }

  // Actualizar reloj de Colombia y bloqueo de las 8:30 p.m. cada 30 segundos
  setInterval(() => {
    if (!$('app-shell').classList.contains('hidden') && state.view === 'income') {
      renderIncomeView();
    }
  }, 30000);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

/* ===================== AUTENTICACIÓN ===================== */
async function showAuthScreen() {
  $('app-shell').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  const cfg = await getCloudConfig();
  $('cfg-supabase-url').value = cfg.url || '';
  $('cfg-supabase-key').value = cfg.anonKey || '';
  if (!cfg.configured) {
    $('cloud-config-box').classList.remove('hidden');
  }
}

async function enterApp() {
  $('auth-screen').classList.add('hidden');
  $('app-shell').classList.remove('hidden');

  await loadLocalState();
  await updateUserIndicators();
  renderCurrentView();

  const mode = await getStorageMode();
  if (mode === 'cloud') {
    await runSync(true);
  } else {
    updateSyncBadge('local', 'Solo local');
  }
}

async function loadLocalState() {
  const [incomes, expenses, loanPayments, savedSettings] = await Promise.all([
    getAll('incomes'),
    getAll('expenses'),
    getAll('loan_payments'),
    getMeta('settings', null)
  ]);
  state.incomes = incomes || [];
  state.expenses = expenses || [];
  state.loanPayments = loanPayments || [];
  state.settings = savedSettings
    ? {
        ...DEFAULT_SETTINGS,
        ...savedSettings,
        workDays: { ...DEFAULT_SETTINGS.workDays, ...(savedSettings.workDays || {}) }
      }
    : { ...DEFAULT_SETTINGS };
  state.overview = computeFinancialOverview(
    state.incomes,
    state.expenses,
    state.loanPayments,
    state.settings
  );
}

async function updateUserIndicators() {
  const mode = await getStorageMode();
  const session = await getSession();
  const isLocal = mode !== 'cloud';
  $('local-mode-banner').classList.toggle('hidden', !isLocal);
  $('sidebar-user-email').textContent = isLocal
    ? 'Modo solo local'
    : session?.user?.email || 'Cuenta conectada';
}

/* ===================== SINCRONIZACIÓN ===================== */
function updateSyncBadge(kind, label) {
  const btn = $('sync-status-btn');
  const txt = $('sync-status-text');
  btn.className = `sync-badge ${kind}`;
  txt.textContent = label;
}

async function runSync(silent = false) {
  if (state.syncing) return;
  const mode = await getStorageMode();
  if (mode !== 'cloud') {
    updateSyncBadge('local', 'Solo local');
    return;
  }
  if (!navigator.onLine) {
    const q = await getSyncQueue();
    updateSyncBadge('offline', q.length > 0 ? `Sin conexión (${q.length})` : 'Sin conexión');
    return;
  }

  state.syncing = true;
  updateSyncBadge('', 'Sincronizando...');
  try {
    const res = await syncWithCloud();
    if (res.status === 'synced') {
      await loadLocalState();
      renderCurrentView();
      updateSyncBadge('synced', 'Sincronizado');
      if (!silent) showToast('Datos sincronizados con la nube.');
      if (res.conflicts > 0) {
        showToast(`Se resolvieron ${res.conflicts} conflicto(s) usando la versión más reciente.`);
      }
    } else if (res.status === 'offline') {
      updateSyncBadge('offline', res.pending > 0 ? `Sin conexión (${res.pending})` : 'Sin conexión');
    } else if (res.status === 'unauthenticated') {
      updateSyncBadge('error', 'Sesión requerida');
    }
  } catch (err) {
    const q = await getSyncQueue();
    updateSyncBadge('error', q.length > 0 ? `Error sync (${q.length})` : 'Error de sincronización');
    if (!silent) showToast(err.message || 'No se pudo sincronizar.', true);
  } finally {
    state.syncing = false;
  }
}

/* ===================== EVENTOS GLOBALES ===================== */
function bindGlobalEvents() {
  // Auth form
  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const alertBox = $('auth-alert');
    alertBox.classList.add('hidden');

    try {
      if (state.isSignupMode) {
        const res = await signUpWithEmail(email, password);
        if (res.needsConfirmation) {
          alertBox.className = 'banner banner-green mb-12';
          alertBox.textContent = 'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.';
          alertBox.classList.remove('hidden');
          return;
        }
      } else {
        await signInWithEmail(email, password);
      }
      await enterApp();
    } catch (err) {
      alertBox.className = 'banner banner-red mb-12';
      alertBox.textContent = err.message || 'No se pudo iniciar sesión.';
      alertBox.classList.remove('hidden');
    }
  });

  $('btn-toggle-signup').addEventListener('click', () => {
    state.isSignupMode = !state.isSignupMode;
    $('btn-auth-submit').textContent = state.isSignupMode ? 'Crear cuenta' : 'Iniciar sesión';
    $('btn-toggle-signup').textContent = state.isSignupMode ? 'Ya tengo cuenta' : 'Crear cuenta';
  });

  $('btn-toggle-cloud-cfg').addEventListener('click', () => {
    $('cloud-config-box').classList.toggle('hidden');
  });

  $('btn-save-cloud-cfg').addEventListener('click', async () => {
    const alertBox = $('auth-alert');
    alertBox.classList.add('hidden');
    try {
      await saveCloudConfig($('cfg-supabase-url').value, $('cfg-supabase-key').value);
      $('cloud-config-box').classList.add('hidden');
      showToast('Conexión de Supabase guardada.');
    } catch (err) {
      alertBox.className = 'banner banner-red mb-12';
      alertBox.textContent = err.message;
      alertBox.classList.remove('hidden');
    }
  });

  $('btn-local-mode').addEventListener('click', async () => {
    await setStorageMode('local');
    await enterApp();
  });

  // Navegación (Sidebar, Bottom Nav y botones data-view)
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-view]');
    if (navBtn) {
      navigateTo(navBtn.dataset.view);
    }
  });

  // Sincronización manual y automática
  $('sync-status-btn').addEventListener('click', () => runSync(false));
  $('btn-force-sync').addEventListener('click', () => runSync(false));

  window.addEventListener('online', () => {
    showToast('Conexión recuperada. Sincronizando...');
    runSync(true);
  });
  window.addEventListener('offline', async () => {
    const q = await getSyncQueue();
    updateSyncBadge('offline', q.length > 0 ? `Sin conexión (${q.length})` : 'Sin conexión');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('app-shell').classList.contains('hidden')) {
      runSync(true);
    }
  });

  // Logout
  const handleLogout = async () => {
    await signOut();
    await showAuthScreen();
  };
  $('btn-logout-sidebar').addEventListener('click', handleLogout);
  $('btn-settings-logout').addEventListener('click', handleLogout);

  // Botones rápidos de ingresos ($40K, $45K, $50K)
  $('quick-income-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-amount-btn');
    if (!btn || btn.disabled) return;
    const amount = Number(btn.dataset.amount);
    const todayStr = getBogotaNow().dateStr;
    saveDailyIncome(todayStr, amount, true, '');
  });

  $('btn-custom-income-today').addEventListener('click', () => {
    const lock = getTodayUnlockStatus(state.settings);
    if (!lock.unlocked) {
      showToast(`El registro de hoy se habilita a las ${lock.unlockLabel} (hora Colombia).`, true);
      return;
    }
    openIncomeModal(getBogotaNow().dateStr);
  });

  $('btn-not-worked-today').addEventListener('click', () => {
    const todayStr = getBogotaNow().dateStr;
    saveDailyIncome(todayStr, 0, false, 'Día sin trabajar');
  });

  $('btn-register-past-income').addEventListener('click', () => {
    openIncomeModal('');
  });

  // Navegación del calendario
  $('btn-cal-prev').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 1) {
      state.calMonth = 12;
      state.calYear--;
    }
    renderIncomeView();
  });

  $('btn-cal-next').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 12) {
      state.calMonth = 1;
      state.calYear++;
    }
    renderIncomeView();
  });

  // Préstamo Rappi: Tabs y botones
  document.querySelectorAll('[data-loan-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.loanTab = btn.dataset.loanTab;
      renderLoanView();
    });
  });

  $('btn-pay-next-installment').addEventListener('click', () => {
    const next = state.overview?.loan?.nextInstallment;
    openInstallmentPaymentModal(next ? next.number : 1);
  });

  $('btn-extra-capital').addEventListener('click', () => {
    openExtraCapitalModal();
  });

  // Formulario de gastos
  $('expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('exp-date').value;
    const category = $('exp-category').value;
    const amount = Number($('exp-amount').value);
    const description = $('exp-desc').value.trim();
    if (!date || !amount || amount <= 0) {
      showToast('Ingresa una fecha y un valor válido.', true);
      return;
    }
    const nowIso = new Date().toISOString();
    const record = {
      id: generateId('exp'),
      date,
      category,
      amount,
      description,
      deleted: false,
      created_at: nowIso,
      updated_at: nowIso
    };
    await putOne('expenses', record);
    await enqueueSync('expenses', record);
    $('exp-amount').value = '';
    $('exp-desc').value = '';
    await refreshAfterMutation('Gasto registrado correctamente.');
  });

  // Filtros de historial
  ['hist-from', 'hist-to', 'hist-type', 'hist-category'].forEach((id) => {
    $(id).addEventListener('input', () => renderHistoryView());
  });

  // Exportación CSV / JSON y Restauración JSON
  $('btn-export-csv').addEventListener('click', handleExportCSV);
  $('btn-export-json').addEventListener('click', handleExportJSON);
  $('input-restore-json').addEventListener('change', handleRestoreJSON);

  // Ajustes
  $('settings-form').addEventListener('submit', handleSaveSettings);

  // Modal close
  $('modal-close').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop')) closeModal();
  });

  // Redibujar gráficos al cambiar tamaño de pantalla
  window.addEventListener('resize', () => {
    if (state.view === 'dashboard' && !$('app-shell').classList.contains('hidden')) {
      renderDashboardCharts();
    }
  });
}

function populateStaticSelects() {
  $('exp-category').innerHTML = EXPENSE_CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
  ).join('');
  $('exp-date').value = getBogotaNow().dateStr;
}

function navigateTo(viewName) {
  if (!VIEW_TITLES[viewName]) return;
  state.view = viewName;
  $('topbar-title').textContent = VIEW_TITLES[viewName];

  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`view-${viewName}`).classList.remove('hidden');

  document.querySelectorAll('.nav-item, .bottom-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  renderCurrentView();
}

function renderCurrentView() {
  if (!state.overview) return;
  switch (state.view) {
    case 'dashboard': renderDashboardView(); break;
    case 'income': renderIncomeView(); break;
    case 'loan': renderLoanView(); break;
    case 'expenses': renderExpensesView(); break;
    case 'stats': renderStatsView(); break;
    case 'history': renderHistoryView(); break;
    case 'settings': renderSettingsView(); break;
  }
}

async function refreshAfterMutation(message) {
  await loadLocalState();
  renderCurrentView();
  showToast(message);
  await runSync(true);
}

/* ===================== VISTA 1: DASHBOARD ===================== */
function renderDashboardView() {
  const ov = state.overview;
  const loan = ov.loan;

  // Alerta de cuota vencida o próxima
  const alertBox = $('dash-alert-box');
  if (loan.overdueInstallmentsCount > 0) {
    alertBox.innerHTML = `<div class="banner banner-red"><span>Tienes <strong>${loan.overdueInstallmentsCount} cuota(s) vencida(s)</strong> en el préstamo Rappi.</span><button class="btn btn-sm btn-danger" data-view="loan">Ver cuotas</button></div>`;
  } else if (loan.nextInstallment) {
    alertBox.innerHTML = `<div class="banner banner-amber"><span>Próxima cuota Rappi: <strong>Cuota #${loan.nextInstallment.number}</strong> por <strong>${formatCOP(loan.nextInstallment.remainingAmount)}</strong> vence el <strong>${formatDateHuman(loan.nextInstallment.dueDate)}</strong>.</span><button class="btn btn-sm btn-amber" data-view="loan">Administrar</button></div>`;
  } else {
    alertBox.innerHTML = `<div class="banner banner-green"><span>Préstamo Rappi completado al 100%.</span></div>`;
  }

  $('dash-kpis').innerHTML = `
    <div class="kpi-card">
      <span class="kpi-label">Ingresos del mes actual</span>
      <span class="kpi-value text-green">${formatCOP(ov.currentMonthIncome)}</span>
      <span class="kpi-sub">Proyección mes: ${formatCOP(ov.projections.projectedThisMonthIncome)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Ingresos acumulados</span>
      <span class="kpi-value text-green">${formatCOP(ov.totalGrossIncome)}</span>
      <span class="kpi-sub">${ov.workedDaysCount} día(s) trabajados</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Cuotas pagadas Rappi</span>
      <span class="kpi-value">${loan.paidInstallmentsCount} / ${loan.totalInstallments}</span>
      <span class="kpi-sub">Pagado: ${formatCOP(loan.totalPaidToRappi)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Deuda total pendiente Rappi</span>
      <span class="kpi-value text-red">${formatCOP(loan.pendingTotalDebt)}</span>
      <span class="kpi-sub">Capital: ${formatCOP(loan.pendingCapital)} · Int/seg: ${formatCOP(loan.pendingFinancialCost)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Próxima cuota</span>
      <span class="kpi-value text-amber">${loan.nextInstallment ? formatCOP(loan.nextInstallment.remainingAmount) : '$0'}</span>
      <span class="kpi-sub">${loan.nextInstallment ? `Cuota #${loan.nextInstallment.number} · ${formatDateHuman(loan.nextInstallment.dueDate)}` : 'Sin cuotas pendientes'}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Dinero disponible (Flujo de caja)</span>
      <span class="kpi-value ${ov.availableCash >= 0 ? 'text-green' : 'text-red'}">${formatCOP(ov.availableCash)}</span>
      <span class="kpi-sub">Después de gastos y pagos a Rappi</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Ganancia neta estimada</span>
      <span class="kpi-value ${ov.netBusinessProfit >= 0 ? 'text-green' : 'text-red'}">${formatCOP(ov.netBusinessProfit)}</span>
      <span class="kpi-sub">Gastos: ${formatCOP(ov.totalExpenses)}</span>
    </div>
  `;

  renderDashboardCharts();

  // Últimos movimientos
  const recentEl = $('dash-recent-list');
  if (ov.recentMovements.length === 0) {
    recentEl.innerHTML = `<p class="text-sm text-muted">Aún no hay movimientos registrados.</p>`;
  } else {
    recentEl.innerHTML = ov.recentMovements
      .map((m) => {
        const color = m.sign === '+' ? 'text-green' : m.sign === '-' ? 'text-red' : 'text-amber';
        return `
          <div class="movement-row">
            <div class="movement-left">
              <div class="movement-title">${escapeHtml(m.typeLabel)} · <span class="text-muted text-xs">${formatDateHuman(m.date)}</span></div>
              <div class="movement-sub">${escapeHtml(m.description)}</div>
            </div>
            <div class="movement-right">
              <div class="movement-amount ${color}">${m.sign === '~' ? '' : m.sign}${formatCOP(m.amount)}</div>
              <div class="text-xs text-subtle">${escapeHtml(m.category)}</div>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function renderDashboardCharts() {
  const ch = state.overview.charts;
  drawBarChart($('chart-daily-income'), ch.dailyLabels, ch.dailyValues, '#22c55e');
  drawBarChart($('chart-monthly-income'), ch.monthLabels, ch.monthlyIncomeValues, '#22c55e');
  drawComparisonChart($('chart-income-vs-loan'), ch.monthLabels, ch.monthlyIncomeValues, ch.monthlyLoanValues);
}

/* ===================== VISTA 2: INGRESOS DIARIOS ===================== */
function renderIncomeView() {
  const lock = getTodayUnlockStatus(state.settings);
  const todayStr = lock.now.dateStr;
  const activeIncomes = state.incomes.filter((r) => !r.deleted);
  const incomeByDate = new Map(activeIncomes.map((r) => [r.date, r]));
  const todayRecord = incomeByDate.get(todayStr);

  $('income-today-subtitle').textContent = `${formatDateHuman(todayStr)} · ${
    isScheduledWorkDay(todayStr, state.settings) ? 'Día laboral configurado' : 'Día habitual sin trabajar'
  }`;
  $('income-clock-badge').textContent = `Colombia ${lock.nowLabel}`;

  const lockBanner = $('income-lock-banner');
  const doneBanner = $('income-today-done-banner');

  if (!lock.unlocked) {
    lockBanner.innerHTML = `<span>El registro del día se habilita automáticamente a las <strong>${lock.unlockLabel}</strong> (hora Colombia). Faltan <strong>${lock.remainingLabel}</strong>.</span>`;
    lockBanner.classList.remove('hidden');
  } else {
    lockBanner.classList.add('hidden');
  }

  if (todayRecord) {
    doneBanner.innerHTML = `<span>Hoy ya registraste <strong>${todayRecord.worked ? formatCOP(todayRecord.amount) : 'Sin trabajar ($0)'}</strong>.</span><button type="button" class="btn btn-sm" id="btn-edit-today-inline">Corregir</button>`;
    doneBanner.classList.remove('hidden');
    $('btn-edit-today-inline').addEventListener('click', () => openIncomeModal(todayStr));
  } else {
    doneBanner.classList.add('hidden');
  }

  // Habilitar o deshabilitar botones grandes según hora de Colombia (8:30 p.m.)
  document.querySelectorAll('#quick-income-buttons .quick-amount-btn').forEach((btn) => {
    btn.disabled = !lock.unlocked;
  });

  // Renderizar calendario mensual
  $('cal-month-title').textContent = `${MONTH_NAMES[state.calMonth - 1]} ${state.calYear}`;
  const firstDow = new Date(state.calYear, state.calMonth - 1, 1).getDay();
  const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate();

  let html = '';
  for (let i = 0; i < firstDow; i++) {
    html += `<div class="cal-cell empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = formatDateStr(state.calYear, state.calMonth, d);
    const rec = incomeByDate.get(ds);
    const scheduled = isScheduledWorkDay(ds, state.settings);
    const isToday = ds === todayStr;
    const isPast = ds < todayStr;

    let cls = 'off';
    let label = '—';
    let amtClass = 'text-subtle';

    if (rec) {
      if (rec.worked && Number(rec.amount) > 0) {
        cls = 'worked';
        label = formatShortK(rec.amount);
        amtClass = 'text-green';
      } else {
        cls = 'off';
        label = 'No trab.';
      }
    } else if (scheduled && (isPast || (isToday && lock.unlocked))) {
      cls = 'pending';
      label = 'Pendiente';
      amtClass = 'text-amber';
    }

    html += `
      <button type="button" class="cal-cell ${cls} ${isToday ? 'today' : ''}" data-cal-date="${ds}">
        <span class="cal-day-num">${d}</span>
        <span class="cal-day-amt ${amtClass}">${label}</span>
      </button>
    `;
  }

  const grid = $('income-calendar-grid');
  grid.innerHTML = html;
  grid.querySelectorAll('[data-cal-date]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const ds = cell.dataset.calDate;
      if (ds > todayStr) {
        showToast('No se pueden registrar ingresos en fechas futuras.', true);
        return;
      }
      if (ds === todayStr && !lock.unlocked && !incomeByDate.get(ds)) {
        showToast(`El registro de hoy se habilita a las ${lock.unlockLabel} (hora Colombia).`, true);
        return;
      }
      openIncomeModal(ds);
    });
  });
}

async function saveDailyIncome(dateStr, amount, worked, note = '', editReason = '') {
  const existing = state.incomes.find((r) => r.date === dateStr && !r.deleted);
  const nowIso = new Date().toISOString();

  if (existing) {
    const history = Array.isArray(existing.edit_history) ? [...existing.edit_history] : [];
    if (Number(existing.amount) !== Number(amount) || Boolean(existing.worked) !== Boolean(worked)) {
      history.push({
        edited_at: nowIso,
        previous_amount: Number(existing.amount),
        new_amount: Number(amount),
        previous_worked: Boolean(existing.worked),
        new_worked: Boolean(worked),
        reason: editReason || 'Corrección manual'
      });
    }
    const updated = {
      ...existing,
      amount: Number(amount),
      worked: Boolean(worked),
      note: note ?? existing.note,
      edit_history: history,
      updated_at: nowIso
    };
    await putOne('incomes', updated);
    await enqueueSync('incomes', updated);
    await refreshAfterMutation(`Ingreso del ${formatDateHuman(dateStr)} actualizado (${formatCOP(amount)}).`);
  } else {
    const record = {
      id: generateId('inc'),
      date: dateStr,
      amount: Number(amount),
      worked: Boolean(worked),
      note: note || '',
      edit_history: [],
      deleted: false,
      created_at: nowIso,
      updated_at: nowIso
    };
    await putOne('incomes', record);
    await enqueueSync('incomes', record);
    await refreshAfterMutation(`Ingreso registrado: ${formatCOP(amount)} (${formatDateHuman(dateStr)}).`);
  }
}

function openIncomeModal(dateStr) {
  const todayStr = getBogotaNow().dateStr;
  const targetDate = dateStr || todayStr;
  const existing = state.incomes.find((r) => r.date === targetDate && !r.deleted);

  openModal(
    existing ? `Editar ingreso — ${formatDateHuman(targetDate)}` : 'Registrar ingreso diario',
    `
      <form id="modal-income-form">
        <div class="form-group">
          <label for="mi-date">Fecha</label>
          <input type="date" id="mi-date" value="${targetDate}" max="${todayStr}" required ${existing ? 'readonly' : ''} />
        </div>
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px; color:var(--text);">
            <input type="checkbox" id="mi-worked" ${!existing || existing.worked ? 'checked' : ''} />
            El vehículo trabajó este día
          </label>
        </div>
        <div class="form-group">
          <label for="mi-amount">Valor recibido (COP)</label>
          <input type="number" id="mi-amount" min="0" step="1000" value="${existing ? existing.amount : state.settings.defaultDailyRate}" required />
        </div>
        <div class="form-group">
          <label for="mi-note">Nota (opcional)</label>
          <input type="text" id="mi-note" value="${escapeHtml(existing?.note || '')}" placeholder="Ej. Tarifa especial" />
        </div>
        ${
          existing
            ? `<div class="form-group">
                 <label for="mi-reason">Motivo de la corrección</label>
                 <input type="text" id="mi-reason" required placeholder="Ej. Ajuste de tarifa real pagada" />
               </div>`
            : ''
        }
        ${
          existing?.edit_history?.length
            ? `<div class="text-xs text-muted mb-12">
                 <strong>Historial de cambios (${existing.edit_history.length}):</strong><br/>
                 ${existing.edit_history
                   .map((h) => `• ${formatDateTimeHuman(h.edited_at)}: ${formatCOP(h.previous_amount)} → ${formatCOP(h.new_amount)} (${escapeHtml(h.reason || '')})`)
                   .join('<br/>')}
               </div>`
            : ''
        }
        <div class="modal-actions">
          ${existing ? `<button type="button" id="mi-delete" class="btn btn-danger">Eliminar</button>` : ''}
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `
  );

  $('mi-worked').addEventListener('change', (e) => {
    if (!e.target.checked) $('mi-amount').value = 0;
  });

  $('modal-income-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = $('mi-date').value;
    const lock = getTodayUnlockStatus(state.settings);
    if (d === todayStr && !lock.unlocked && !existing) {
      showToast(`El registro de hoy se habilita a las ${lock.unlockLabel} (hora Colombia).`, true);
      return;
    }
    const worked = $('mi-worked').checked;
    const amt = worked ? Number($('mi-amount').value) : 0;
    const note = $('mi-note').value.trim();
    const reason = $('mi-reason') ? $('mi-reason').value.trim() : '';
    closeModal();
    await saveDailyIncome(d, amt, worked, note, reason);
  });

  if (existing) {
    $('mi-delete').addEventListener('click', () => {
      confirmDelete('¿Eliminar este registro de ingreso?', async () => {
        const updated = { ...existing, deleted: true, updated_at: new Date().toISOString() };
        await putOne('incomes', updated);
        await enqueueSync('incomes', updated);
        await refreshAfterMutation('Registro de ingreso eliminado.');
      });
    });
  }
}

/* ===================== VISTA 3: PRÉSTAMO RAPPI ===================== */
function renderLoanView() {
  const loan = state.overview.loan;
  const sim = loan.simulation;

  $('loan-kpis').innerHTML = `
    <div class="kpi-card">
      <span class="kpi-label">Total préstamo (36 cuotas)</span>
      <span class="kpi-value">${formatCOP(loan.originalTotalLoan)}</span>
      <span class="kpi-sub">Capital: ${formatCOP(loan.initialCapital)} · Int/seg/com: ${formatCOP(loan.originalFinancialCost)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Deuda total por pagar${sim.isSimulated ? ' (est.)' : ''}</span>
      <span class="kpi-value text-red">${formatCOP(loan.pendingTotalDebt)}</span>
      <span class="kpi-sub">Capital: ${formatCOP(loan.pendingCapital)} · Int/seg: ${formatCOP(loan.pendingFinancialCost)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Total pagado a Rappi</span>
      <span class="kpi-value">${formatCOP(loan.totalPaidToRappi)}</span>
      <span class="kpi-sub">Capital amortizado: ${formatCOP(loan.amortizedCapital)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Finalización estimada</span>
      <span class="kpi-value text-amber">${sim.hasExtraCapital ? (sim.estimatedEndDate === 'Pagado' ? 'Pagado' : formatDateHuman(sim.estimatedEndDate)) : formatDateHuman(loan.originalEndDate)}</span>
      <span class="kpi-sub">${sim.monthsSaved > 0 ? `Ahorro est.: ${sim.monthsSaved} cuota(s)` : 'Calendario original'}</span>
    </div>
  `;

  const simBanner = $('loan-simulation-banner');
  if (sim.hasExtraCapital) {
    simBanner.innerHTML = `
      <span>
        <strong>Simulación estimada por abonos a capital (${formatCOP(loan.totalExtraCapital)}):</strong>
        Ahorro estimado de <strong>${sim.monthsSaved} cuota(s)</strong> y aprox. <strong>${formatCOP(sim.estimatedInterestSaved)}</strong> en intereses futuros.
        <em>Esta proyección es una simulación estimada basada en el plan original y no constituye saldo oficial de Rappi.</em>
      </span>
    `;
    simBanner.classList.remove('hidden');
  } else {
    simBanner.classList.add('hidden');
  }

  document.querySelectorAll('[data-loan-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.loanTab === state.loanTab);
  });
  $('loan-tab-original').classList.toggle('hidden', state.loanTab !== 'original');
  $('loan-tab-comparison').classList.toggle('hidden', state.loanTab !== 'comparison');
  $('loan-tab-payments').classList.toggle('hidden', state.loanTab !== 'payments');

  // TAB 1: Tabla oficial de las 36 cuotas
  const statusLabels = {
    paid: ['Pagada', 'status-paid'],
    partial: ['Parcial', 'status-partial'],
    overdue: ['Vencida', 'status-overdue'],
    pending: ['Pendiente', 'status-neutral']
  };

  $('loan-tab-original').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Vencimiento</th>
          <th class="num">Cuota oficial</th>
          <th class="num">Capital</th>
          <th class="num">Interés</th>
          <th class="num">Seguro / Com.</th>
          <th class="num">Pagado</th>
          <th>Estado</th>
          <th>Pago real</th>
          <th>Acción</th>
        </tr>
      </thead>
      <tbody>
        ${loan.installments
          .map((row) => {
            const [stTxt, stCls] = statusLabels[row.status];
            const insFee = row.insurance + row.fee;
            return `
              <tr>
                <td><strong>${row.number}</strong></td>
                <td>${formatDateHuman(row.dueDate)}</td>
                <td class="num">${formatCOP(row.installment, true)}</td>
                <td class="num">${formatCOP(row.capital, true)}</td>
                <td class="num">${formatCOP(row.interest, true)}</td>
                <td class="num">${formatCOP(insFee, true)}</td>
                <td class="num ${row.paidAmount > 0 ? 'text-green' : 'text-muted'}">
                  ${formatCOP(row.paidAmount)}
                  ${row.remainingAmount > 1 && row.paidAmount > 0 ? `<div class="text-xs text-amber">Falta ${formatCOP(row.remainingAmount)}</div>` : ''}
                </td>
                <td><span class="status-pill ${stCls}">${stTxt}</span></td>
                <td>${row.actualPaymentDate ? formatDateHuman(row.actualPaymentDate) : '—'}</td>
                <td>
                  ${
                    row.status !== 'paid'
                      ? `<button type="button" class="btn btn-sm" data-pay-inst="${row.number}">Pagar</button>`
                      : '<span class="text-xs text-green">Completa</span>'
                  }
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  $('loan-tab-original').querySelectorAll('[data-pay-inst]').forEach((btn) => {
    btn.addEventListener('click', () => openInstallmentPaymentModal(Number(btn.dataset.payInst)));
  });

  // TAB 2: Comparativa Original vs. Actualizado (Simulación)
  $('loan-tab-comparison').innerHTML = `
    <div class="kpi-grid mb-12">
      <div class="kpi-card">
        <span class="kpi-label">Por pagar (Plan original)</span>
        <span class="kpi-value">${formatCOP(sim.originalRemainingTotal)}</span>
        <span class="kpi-sub">Fin: ${formatDateHuman(loan.originalEndDate)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Por pagar (Simulación actualizada)</span>
        <span class="kpi-value text-green">${formatCOP(sim.simulatedRemainingTotal)}</span>
        <span class="kpi-sub">Fin est.: ${sim.estimatedEndDate === 'Pagado' ? 'Pagado' : formatDateHuman(sim.estimatedEndDate)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Ahorro total estimado</span>
        <span class="kpi-value text-green">${formatCOP(sim.estimatedTotalSaved)}</span>
        <span class="kpi-sub">${sim.monthsSaved} cuota(s) menos (estimación)</span>
      </div>
    </div>
    <p class="text-xs text-amber mb-12">
      Nota: Cuando realizas abonos extraordinarios a capital, esta tabla muestra una simulación estimada usando las tasas inferidas del plan original. Consulta siempre el extracto oficial de Rappi para confirmar el saldo exacto.
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Cuota #</th>
            <th>Fecha</th>
            <th class="num">Cuota original</th>
            <th class="num">Cuota simulada</th>
            <th class="num">Saldo simulado</th>
          </tr>
        </thead>
        <tbody>
          ${loan.installments
            .filter((i) => i.status !== 'paid')
            .map((orig) => {
              const simRow = sim.rows.find((r) => r.number === orig.number);
              return `
                <tr>
                  <td>#${orig.number}</td>
                  <td>${formatDateHuman(orig.dueDate)}</td>
                  <td class="num">${formatCOP(orig.installment, true)}</td>
                  <td class="num ${simRow ? '' : 'text-green'}">${simRow ? formatCOP(simRow.installment, true) : 'Ahorrada ($0)'}</td>
                  <td class="num">${simRow ? formatCOP(simRow.balance, true) : '$0'}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  // TAB 3: Pagos registrados
  const activePays = state.loanPayments
    .filter((p) => !p.deleted)
    .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));

  if (activePays.length === 0) {
    $('loan-tab-payments').innerHTML = `<p class="text-sm text-muted">Aún no has registrado pagos de cuotas ni abonos extraordinarios.</p>`;
  } else {
    const excessLabels = {
      none: 'Sin excedente',
      extra_capital: 'Excedente → Abono a capital',
      next_installment: 'Excedente → Siguiente cuota',
      other_charges: 'Excedente → Otros cargos/mora'
    };
    $('loan-tab-payments').innerHTML = activePays
      .map(
        (p) => `
          <div class="movement-row">
            <div class="movement-left">
              <div class="movement-title">
                ${p.payment_type === 'extra_capital' ? 'Abono extraordinario a capital' : `Pago Cuota #${p.installment_number}`}
                · <span class="text-xs text-muted">${formatDateHuman(p.payment_date)}</span>
              </div>
              <div class="movement-sub">
                ${p.excess_amount > 0 ? `${excessLabels[p.excess_application] || ''} (${formatCOP(p.excess_amount)}) · ` : ''}
                ${escapeHtml(p.note || 'Sin observaciones')}
              </div>
            </div>
            <div class="movement-right" style="display:flex; align-items:center; gap:10px;">
              <div>
                <div class="movement-amount text-red">-${formatCOP(p.amount_paid)}</div>
                <div class="text-xs text-subtle">${formatDateTimeHuman(p.updated_at)}</div>
              </div>
              <button type="button" class="btn btn-sm btn-danger" data-del-loan="${p.id}">Eliminar</button>
            </div>
          </div>
        `
      )
      .join('');

    $('loan-tab-payments').querySelectorAll('[data-del-loan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rec = state.loanPayments.find((x) => x.id === btn.dataset.delLoan);
        if (!rec) return;
        confirmDelete('¿Eliminar este registro de pago del préstamo?', async () => {
          const updated = { ...rec, deleted: true, updated_at: new Date().toISOString() };
          await putOne('loan_payments', updated);
          await enqueueSync('loan_payments', updated);
          await refreshAfterMutation('Pago eliminado correctamente.');
        });
      });
    });
  }
}

function openInstallmentPaymentModal(installmentNumber) {
  const loan = state.overview.loan;
  const inst = loan.installments.find((i) => i.number === installmentNumber) || loan.installments[0];
  const todayStr = getBogotaNow().dateStr;

  openModal(
    `Registrar pago — Cuota #${inst.number}`,
    `
      <div class="banner mb-12">
        <div class="text-xs">
          <div>Cuota contractual: <strong>${formatCOP(inst.installment, true)}</strong></div>
          <div>Ya pagado en esta cuota: <strong>${formatCOP(inst.paidAmount, true)}</strong></div>
          <div>Pendiente para completar cuota: <strong class="text-amber">${formatCOP(inst.remainingAmount, true)}</strong></div>
        </div>
      </div>
      <form id="modal-loan-pay-form">
        <div class="form-row">
          <div class="form-group">
            <label for="lp-inst">Número de cuota</label>
            <select id="lp-inst">
              ${loan.installments
                .map((i) => `<option value="${i.number}" ${i.number === inst.number ? 'selected' : ''}>Cuota #${i.number} (${formatDateHuman(i.dueDate)})</option>`)
                .join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="lp-date">Fecha real de pago</label>
            <input type="date" id="lp-date" value="${todayStr}" required />
          </div>
        </div>
        <div class="form-group">
          <label for="lp-amount">Valor efectivamente pagado (COP)</label>
          <input type="number" id="lp-amount" min="1" step="0.01" value="${Math.round(inst.remainingAmount)}" required />
        </div>

        <div id="lp-breakdown-box" class="banner mb-12 text-xs"></div>

        <div id="lp-excess-group" class="form-group hidden">
          <label for="lp-excess-app">¿Cómo se aplicó el excedente?</label>
          <select id="lp-excess-app">
            <option value="extra_capital">Abono extraordinario a capital (reduce deuda)</option>
            <option value="next_installment">Abono anticipado a la siguiente cuota</option>
            <option value="other_charges">Otros cargos / mora / ajuste (no reduce capital)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="lp-note">Observación (opcional)</label>
          <input type="text" id="lp-note" placeholder="Ej. Transferencia desde RappiPay" />
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">Registrar pago</button>
        </div>
      </form>
    `
  );

  const updateBreakdown = () => {
    const selectedNum = Number($('lp-inst').value);
    const target = loan.installments.find((i) => i.number === selectedNum);
    const paid = Number($('lp-amount').value) || 0;
    const needed = target.remainingAmount;
    const box = $('lp-breakdown-box');
    const excessGroup = $('lp-excess-group');

    if (paid > needed + 1) {
      const excess = Number((paid - needed).toFixed(2));
      box.className = 'banner banner-amber mb-12 text-xs';
      box.innerHTML = `<span>Aplicado a cuota #${selectedNum}: <strong>${formatCOP(needed)}</strong> · Excedente detectado: <strong>${formatCOP(excess)}</strong>. Selecciona abajo cómo se aplicó.</span>`;
      excessGroup.classList.remove('hidden');
    } else if (paid < needed - 1 && paid > 0) {
      const stillMissing = Number((needed - paid).toFixed(2));
      box.className = 'banner mb-12 text-xs';
      box.innerHTML = `<span>Pago parcial: quedarán faltando <strong>${formatCOP(stillMissing)}</strong> para completar la cuota #${selectedNum}.</span>`;
      excessGroup.classList.add('hidden');
    } else {
      box.className = 'banner banner-green mb-12 text-xs';
      box.innerHTML = `<span>Pago exacto: la cuota #${selectedNum} quedará marcada como <strong>Pagada</strong>.</span>`;
      excessGroup.classList.add('hidden');
    }
  };

  $('lp-inst').addEventListener('change', () => {
    const selectedNum = Number($('lp-inst').value);
    const target = loan.installments.find((i) => i.number === selectedNum);
    $('lp-amount').value = Math.round(target.remainingAmount);
    updateBreakdown();
  });
  $('lp-amount').addEventListener('input', updateBreakdown);
  updateBreakdown();

  $('modal-loan-pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const selectedNum = Number($('lp-inst').value);
    const target = loan.installments.find((i) => i.number === selectedNum);
    const date = $('lp-date').value;
    const paid = Number($('lp-amount').value);
    const note = $('lp-note').value.trim();

    if (!date || paid <= 0) {
      showToast('Ingresa un valor válido.', true);
      return;
    }

    const needed = target.remainingAmount;
    const applied = Math.min(paid, needed);
    const excess = Math.max(0, Number((paid - needed).toFixed(2)));
    const excessApp = excess > 1 ? $('lp-excess-app').value : 'none';
    const extraCap = excessApp === 'extra_capital' ? excess : 0;

    const nowIso = new Date().toISOString();
    const record = {
      id: generateId('pay'),
      installment_number: selectedNum,
      payment_type: 'installment',
      payment_date: date,
      amount_paid: paid,
      contractual_amount: target.installment,
      applied_to_installment: Number(applied.toFixed(2)),
      excess_amount: excess,
      excess_application: excessApp,
      extra_capital_amount: extraCap,
      note,
      deleted: false,
      created_at: nowIso,
      updated_at: nowIso
    };

    await putOne('loan_payments', record);
    await enqueueSync('loan_payments', record);
    closeModal();
    await refreshAfterMutation(`Pago registrado para la cuota #${selectedNum} (${formatCOP(paid)}).`);
  });
}

function openExtraCapitalModal() {
  const todayStr = getBogotaNow().dateStr;
  openModal(
    'Abono extraordinario a capital',
    `
      <p class="text-xs text-muted mb-12">
        Este abono reduce directamente el capital pendiente de tu préstamo Rappi y actualiza la simulación estimada de cuotas restantes.
      </p>
      <form id="modal-extra-cap-form">
        <div class="form-group">
          <label for="ec-date">Fecha del abono</label>
          <input type="date" id="ec-date" value="${todayStr}" required />
        </div>
        <div class="form-group">
          <label for="ec-amount">Valor abonado a capital (COP)</label>
          <input type="number" id="ec-amount" min="1000" step="1000" required placeholder="Ej. 500000" />
        </div>
        <div class="form-group">
          <label for="ec-note">Observación (opcional)</label>
          <input type="text" id="ec-note" placeholder="Ej. Abono extra con excedentes de diciembre" />
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">Guardar abono</button>
        </div>
      </form>
    `
  );

  $('modal-extra-cap-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('ec-date').value;
    const amount = Number($('ec-amount').value);
    const note = $('ec-note').value.trim();
    if (!date || amount <= 0) return;

    const nowIso = new Date().toISOString();
    const record = {
      id: generateId('cap'),
      installment_number: null,
      payment_type: 'extra_capital',
      payment_date: date,
      amount_paid: amount,
      contractual_amount: 0,
      applied_to_installment: 0,
      excess_amount: 0,
      excess_application: 'none',
      extra_capital_amount: amount,
      note,
      deleted: false,
      created_at: nowIso,
      updated_at: nowIso
    };

    await putOne('loan_payments', record);
    await enqueueSync('loan_payments', record);
    closeModal();
    await refreshAfterMutation(`Abono extraordinario de ${formatCOP(amount)} registrado.`);
  });
}

/* ===================== VISTA 4: GASTOS Y UTILIDAD ===================== */
function renderExpensesView() {
  const ov = state.overview;
  const loan = ov.loan;

  $('finance-summary-kpis').innerHTML = `
    <div class="kpi-card">
      <span class="kpi-label">Ingresos brutos</span>
      <span class="kpi-value text-green">${formatCOP(ov.totalGrossIncome)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Gastos operativos</span>
      <span class="kpi-value text-red">${formatCOP(ov.totalExpenses)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Pagos de cuotas Rappi</span>
      <span class="kpi-value text-red">${formatCOP(loan.totalContractualPayments)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Abonos extraordinarios</span>
      <span class="kpi-value text-amber">${formatCOP(loan.totalExtraCapital)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Dinero disponible (Flujo de caja)</span>
      <span class="kpi-value ${ov.availableCash >= 0 ? 'text-green' : 'text-red'}">${formatCOP(ov.availableCash)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Resultado neto real</span>
      <span class="kpi-value ${ov.netBusinessProfit >= 0 ? 'text-green' : 'text-red'}">${formatCOP(ov.netBusinessProfit)}</span>
    </div>
  `;

  const activeExpenses = state.expenses
    .filter((e) => !e.deleted)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const listEl = $('expenses-list');
  if (activeExpenses.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-muted">No has registrado gastos operativos todavía.</p>`;
  } else {
    listEl.innerHTML = activeExpenses
      .map(
        (e) => `
          <div class="movement-row">
            <div class="movement-left">
              <div class="movement-title">${escapeHtml(e.category)} · <span class="text-xs text-muted">${formatDateHuman(e.date)}</span></div>
              <div class="movement-sub">${escapeHtml(e.description || 'Sin descripción')}</div>
            </div>
            <div class="movement-right" style="display:flex; align-items:center; gap:10px;">
              <div class="movement-amount text-red">-${formatCOP(e.amount)}</div>
              <button type="button" class="btn btn-sm btn-danger" data-del-exp="${e.id}">Eliminar</button>
            </div>
          </div>
        `
      )
      .join('');

    listEl.querySelectorAll('[data-del-exp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rec = state.expenses.find((x) => x.id === btn.dataset.delExp);
        if (!rec) return;
        confirmDelete('¿Eliminar este gasto operativo?', async () => {
          const updated = { ...rec, deleted: true, updated_at: new Date().toISOString() };
          await putOne('expenses', updated);
          await enqueueSync('expenses', updated);
          await refreshAfterMutation('Gasto eliminado.');
        });
      });
    });
  }
}

/* ===================== VISTA 5: ESTADÍSTICAS Y PROYECCIONES ===================== */
function renderStatsView() {
  const ov = state.overview;
  const p = ov.projections;

  $('stats-kpis').innerHTML = `
    <div class="kpi-card"><span class="kpi-label">Ingreso de hoy</span><span class="kpi-value text-green">${formatCOP(ov.todayIncome)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Ingresos últimos 7 días</span><span class="kpi-value text-green">${formatCOP(ov.weeklyIncome)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Ingresos del mes actual</span><span class="kpi-value text-green">${formatCOP(ov.currentMonthIncome)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Ingresos del año actual</span><span class="kpi-value text-green">${formatCOP(ov.currentYearIncome)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Promedio por día trabajado</span><span class="kpi-value">${formatCOP(ov.avgDailyIncome)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Promedio mensual registrado</span><span class="kpi-value">${formatCOP(ov.avgMonthlyIncome)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Gastos acumulados</span><span class="kpi-value text-red">${formatCOP(ov.totalExpenses)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Dinero destinado a Rappi</span><span class="kpi-value text-red">${formatCOP(ov.loan.totalPaidToRappi)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Deuda total restante Rappi</span><span class="kpi-value text-red">${formatCOP(ov.loan.pendingTotalDebt)}</span><span class="kpi-sub">Capital: ${formatCOP(ov.loan.pendingCapital)}</span></div>
    <div class="kpi-card"><span class="kpi-label">Resultado neto real</span><span class="kpi-value ${ov.netBusinessProfit >= 0 ? 'text-green' : 'text-red'}">${formatCOP(ov.netBusinessProfit)}</span></div>
  `;

  const activeDayNames = Object.entries(state.settings.workDays)
    .filter(([, v]) => v)
    .map(([k]) => DAY_NAMES_SHORT[Number(k)])
    .join(', ');

  $('proj-rules-note').textContent = `Cálculo basado en tu horario activo (${activeDayNames || 'ninguno'}) con tarifa base de ${formatCOP(state.settings.defaultDailyRate)}${
    state.settings.decemberAllDays
      ? ` y regla de diciembre (todos los días a ${formatCOP(state.settings.decemberRate)}).`
      : '.'
  }`;

  $('projections-kpis').innerHTML = `
    <div class="kpi-card">
      <span class="kpi-label">Ingreso estimado este mes</span>
      <span class="kpi-value text-green">${formatCOP(p.projectedThisMonthIncome)}</span>
      <span class="kpi-sub">Faltan ${p.remainingWorkDaysThisMonth} día(s) laborales</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Excedente estimado tras cuota</span>
      <span class="kpi-value ${p.projectedLeftAfterQuota >= 0 ? 'text-green' : 'text-red'}">${formatCOP(p.projectedLeftAfterQuota)}</span>
      <span class="kpi-sub">Cuota pendiente: ${formatCOP(p.nextQuotaAmount)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Fin estimado del préstamo</span>
      <span class="kpi-value text-amber">${p.estimatedLoanEndDate === 'Pagado' ? 'Pagado' : formatDateHuman(p.estimatedLoanEndDate)}</span>
      <span class="kpi-sub">${p.isLoanEndSimulated ? 'Simulación con abonos' : 'Plan original Rappi'}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Proyección primer año (12 meses)</span>
      <span class="kpi-value text-green">${formatCOP(p.year1ProjectedIncome)}</span>
      <span class="kpi-sub">${p.year1WorkDays} días laborales estimados</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Proyección a 36 meses</span>
      <span class="kpi-value text-green">${formatCOP(p.months36ProjectedIncome)}</span>
      <span class="kpi-sub">${p.months36WorkDays} días laborales estimados</span>
    </div>
  `;
}

/* ===================== VISTA 6: HISTORIAL Y DATOS ===================== */
function renderHistoryView() {
  const from = $('hist-from').value;
  const to = $('hist-to').value;
  const type = $('hist-type').value;
  const query = $('hist-category').value.trim().toLowerCase();

  let items = buildUnifiedHistory(state.incomes, state.expenses, state.loanPayments);
  if (from) items = items.filter((i) => i.date >= from);
  if (to) items = items.filter((i) => i.date <= to);
  if (type !== 'all') items = items.filter((i) => i.type === type);
  if (query) {
    items = items.filter(
      (i) =>
        i.category.toLowerCase().includes(query) ||
        i.description.toLowerCase().includes(query) ||
        i.typeLabel.toLowerCase().includes(query)
    );
  }

  const listEl = $('history-list');
  if (items.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-muted">No se encontraron movimientos con los filtros seleccionados.</p>`;
    return;
  }

  listEl.innerHTML = items
    .map((m) => {
      const color = m.sign === '+' ? 'text-green' : m.sign === '-' ? 'text-red' : 'text-amber';
      return `
        <div class="movement-row">
          <div class="movement-left">
            <div class="movement-title">${escapeHtml(m.typeLabel)} · <span class="text-xs text-muted">${formatDateHuman(m.date)}</span></div>
            <div class="movement-sub">${escapeHtml(m.category)} — ${escapeHtml(m.description)}</div>
            <div class="text-xs text-subtle">Creado: ${formatDateTimeHuman(m.created_at)} · Editado: ${formatDateTimeHuman(m.updated_at)}</div>
          </div>
          <div class="movement-right">
            <div class="movement-amount ${color}">${m.sign === '~' ? '' : m.sign}${formatCOP(m.amount)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

function handleExportCSV() {
  const items = buildUnifiedHistory(state.incomes, state.expenses, state.loanPayments);
  const headers = ['Fecha', 'Tipo', 'Categoria', 'Monto_COP', 'Descripcion', 'Creado', 'Modificado'];
  const rows = items.map((m) => [
    m.date,
    m.typeLabel,
    m.category,
    m.sign === '-' ? -m.amount : m.amount,
    m.description,
    m.created_at,
    m.updated_at
  ]);
  const csv = toCSV(headers, rows);
  downloadTextFile(`mi-motocarro-historial-${getBogotaNow().dateStr}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('Historial exportado en CSV.');
}

async function handleExportJSON() {
  const backup = await exportFullBackup(state.settings);
  downloadTextFile(
    `mi-motocarro-respaldo-${getBogotaNow().dateStr}.json`,
    JSON.stringify(backup, null, 2),
    'application/json;charset=utf-8'
  );
  showToast('Copia de seguridad JSON descargada.');
}

async function handleRestoreJSON(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const count = await restoreFromBackup(payload);
    await refreshAfterMutation(`Respaldo restaurado correctamente (${count} registros).`);
  } catch (err) {
    showToast(err.message || 'No se pudo leer el archivo JSON.', true);
  }
}

/* ===================== VISTA 7: AJUSTES ===================== */
async function renderSettingsView() {
  const s = state.settings;
  $('settings-days-grid').innerHTML = DAY_NAMES_SHORT.map(
    (label, idx) => `
      <button type="button" class="day-toggle ${s.workDays[idx] ? 'active' : ''}" data-day-idx="${idx}">
        <span>${label}</span>
        <span>${s.workDays[idx] ? 'Sí' : 'No'}</span>
      </button>
    `
  ).join('');

  $('settings-days-grid').querySelectorAll('[data-day-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.dayIdx);
      state.settings.workDays[idx] = !state.settings.workDays[idx];
      renderSettingsView();
    });
  });

  $('set-default-rate').value = s.defaultDailyRate;
  $('set-unlock-time').value = `${String(s.unlockHour).padStart(2, '0')}:${String(s.unlockMinute).padStart(2, '0')}`;
  $('set-dec-all').checked = Boolean(s.decemberAllDays);
  $('set-dec-rate').value = s.decemberRate;
  $('set-first-due').value = s.firstDueDate || '2026-12-21';

  const mode = await getStorageMode();
  const lastSync = await getMeta('last_synced_at', null);
  const q = await getSyncQueue();
  $('settings-sync-summary').textContent =
    mode === 'cloud'
      ? `Sincronización en la nube activa. Última sincronización: ${lastSync ? formatDateTimeHuman(lastSync) : 'Pendiente'}. Cambios en cola offline: ${q.length}.`
      : 'Actualmente estás en modo solo local (IndexedDB). Cierra sesión e inicia con tu cuenta Supabase para activar sincronización entre iPhone y PC.';

  const conflicts = await getConflicts();
  $('conflicts-list').innerHTML =
    conflicts.length === 0
      ? 'Sin conflictos registrados.'
      : conflicts
          .slice(0, 10)
          .map((c) => `<div style="margin-bottom:6px;">• ${formatDateTimeHuman(c.resolved_at)} — ${escapeHtml(c.table)}: ${escapeHtml(c.resolution)}</div>`)
          .join('');
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const [uh, um] = ($('set-unlock-time').value || '20:30').split(':').map(Number);
  const updated = {
    ...state.settings,
    defaultDailyRate: Number($('set-default-rate').value) || 45000,
    unlockHour: Number.isFinite(uh) ? uh : 20,
    unlockMinute: Number.isFinite(um) ? um : 30,
    decemberAllDays: $('set-dec-all').checked,
    decemberRate: Number($('set-dec-rate').value) || 45000,
    firstDueDate: $('set-first-due').value || '2026-12-21'
  };
  await setMeta('settings', updated);
  await enqueueSync('user_settings', { id: 'settings', updated_at: new Date().toISOString() });
  await refreshAfterMutation('Ajustes guardados.');
}

/* ===================== MODAL Y TOAST ===================== */
function openModal(title, bodyHtml) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  $('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  $('modal-backdrop').classList.add('hidden');
  $('modal-body').innerHTML = '';
}

function confirmDelete(message, onConfirm) {
  openModal(
    'Confirmar eliminación',
    `
      <p class="text-sm text-muted">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button type="button" id="confirm-cancel" class="btn">Cancelar</button>
        <button type="button" id="confirm-ok" class="btn btn-danger">Sí, eliminar</button>
      </div>
    `
  );
  $('confirm-cancel').addEventListener('click', closeModal);
  $('confirm-ok').addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${isError ? 'error' : ''}`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3400);
}

init();
