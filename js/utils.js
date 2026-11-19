/**
 * UTILIDADES GENERALES: Moneda COP, hora oficial de Colombia (America/Bogota),
 * validaciones, UUIDs, CSV y utilidades de fechas.
 */

export const BOGOTA_TZ = 'America/Bogota';

export const DEFAULT_SETTINGS = {
  // 0=Domingo, 1=Lunes, 2=Martes, 3=Miércoles, 4=Jueves, 5=Viernes, 6=Sábado
  workDays: {
    0: true,  // Domingo
    1: false, // Lunes
    2: true,  // Martes
    3: true,  // Miércoles
    4: true,  // Jueves
    5: true,  // Viernes
    6: false  // Sábado
  },
  defaultDailyRate: 45000,
  quickAmounts: [40000, 45000, 50000],
  decemberAllDays: true,
  decemberRate: 45000,
  unlockHour: 20,   // 8:30 p. m.
  unlockMinute: 30,
  firstDueDate: '2026-12-21',
  businessStartDate: ''
};

export const EXPENSE_CATEGORIES = [
  'Mantenimiento',
  'Reparaciones',
  'Llantas',
  'Aceite',
  'Repuestos',
  'SOAT',
  'Impuestos',
  'Otros gastos'
];

export const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DAY_NAMES_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Formato monetario colombiano: $40.000, $363.000, $8.000.000
 * Si showDecimals es true, muestra coma decimal: $363.050,95
 */
export function formatCOP(value, showDecimals = false) {
  const num = Number(value) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0
  }).format(showDecimals ? abs : Math.round(abs));
  return `${sign}$${formatted}`;
}

export function formatShortK(value) {
  const num = Number(value) || 0;
  if (Math.abs(num) >= 1000000) {
    return `$${(num / 1000000).toFixed(1).replace('.', ',')}M`;
  }
  if (Math.abs(num) >= 1000) {
    const k = num / 1000;
    const label = Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
    return `$${label}K`;
  }
  return formatCOP(num);
}

/**
 * Obtiene la fecha y hora actuales en zona horaria America/Bogota.
 */
export function getBogotaNow(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(referenceDate);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);
  const dateStr = `${map.year}-${map.month}-${map.day}`;

  return { year, month, day, hour, minute, second, dateStr };
}

/**
 * Verifica si el registro de ingresos para HOY está habilitado según la hora de Colombia.
 */
export function getTodayUnlockStatus(settings = DEFAULT_SETTINGS, referenceDate = new Date()) {
  const now = getBogotaNow(referenceDate);
  const unlockHour = Number(settings.unlockHour ?? 20);
  const unlockMinute = Number(settings.unlockMinute ?? 30);
  const nowMinutes = now.hour * 60 + now.minute;
  const targetMinutes = unlockHour * 60 + unlockMinute;
  const unlocked = nowMinutes >= targetMinutes;
  const remainingMinutes = Math.max(0, targetMinutes - nowMinutes);
  const remH = Math.floor(remainingMinutes / 60);
  const remM = remainingMinutes % 60;

  return {
    unlocked,
    now,
    unlockLabel: formatTime12h(unlockHour, unlockMinute),
    nowLabel: formatTime12h(now.hour, now.minute),
    remainingLabel: remH > 0 ? `${remH} h ${remM} min` : `${remM} min`
  };
}

export function formatTime12h(hour, minute) {
  const period = hour >= 12 ? 'p. m.' : 'a. m.';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * Convierte YYYY-MM-DD a objeto Date sin problemas de desfase por zona horaria.
 */
export function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateStr(year, month1Based, day) {
  return `${year}-${String(month1Based).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatDateHuman(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

export function formatDateTimeHuman(isoStr) {
  if (!isoStr) return '—';
  try {
    const dt = new Date(isoStr);
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: BOGOTA_TZ,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(dt);
  } catch {
    return isoStr;
  }
}

/**
 * Determina si una fecha YYYY-MM-DD corresponde a un día laboral según ajustes.
 */
export function isScheduledWorkDay(dateStr, settings = DEFAULT_SETTINGS) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m === 12 && settings.decemberAllDays) return true;
  const dow = new Date(y, m - 1, d).getDay();
  return Boolean(settings.workDays?.[dow]);
}

/**
 * Tarifa esperada para una fecha según ajustes (diciembre vs resto del año).
 */
export function getExpectedDailyRate(dateStr, settings = DEFAULT_SETTINGS) {
  const [, m] = dateStr.split('-').map(Number);
  if (m === 12 && settings.decemberAllDays) {
    return Number(settings.decemberRate ?? 45000);
  }
  return Number(settings.defaultDailyRate ?? 45000);
}

export function generateId(prefix = 'rec') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
}

export function toCSV(headers, rows) {
  const escapeCell = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}
