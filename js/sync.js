/**
 * AUTENTICACIÓN Y SINCRONIZACIÓN BIDIRECCIONAL CON SUPABASE
 * Implementación directa con fetch() sobre Supabase Auth (GoTrue) y PostgREST,
 * sin dependencias externas pesadas, compatible 100% con Safari iOS y modo offline.
 */

import {
  getAll,
  getOne,
  putOne,
  getMeta,
  setMeta,
  getSyncQueue,
  removeQueueItem,
  logConflict
} from './db.js';
import { DEFAULT_SETTINGS } from './utils.js';

const SESSION_META_KEY = 'supabase_session';
const CLOUD_CONFIG_META_KEY = 'supabase_custom_config';
const MODE_META_KEY = 'storage_mode'; // 'cloud' | 'local'

export async function getCloudConfig() {
  const saved = await getMeta(CLOUD_CONFIG_META_KEY, null);
  const envCfg = window.APP_CONFIG || {};
  const url = (saved?.url || envCfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = (saved?.anonKey || envCfg.SUPABASE_ANON_KEY || '').trim();
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

export async function saveCloudConfig(url, anonKey) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const cleanKey = String(anonKey || '').trim();
  if (!cleanUrl.startsWith('https://') && !cleanUrl.startsWith('http://')) {
    throw new Error('La URL del proyecto debe comenzar con https://');
  }
  if (cleanKey.length < 20) {
    throw new Error('La clave pública (anon key) parece incompleta.');
  }
  await setMeta(CLOUD_CONFIG_META_KEY, { url: cleanUrl, anonKey: cleanKey });
}

export async function getStorageMode() {
  return getMeta(MODE_META_KEY, null);
}

export async function setStorageMode(mode) {
  await setMeta(MODE_META_KEY, mode);
}

export async function getSession() {
  return getMeta(SESSION_META_KEY, null);
}

export async function clearSession() {
  await setMeta(SESSION_META_KEY, null);
}

function buildHeaders(anonKey, accessToken = null, extra = {}) {
  const headers = {
    apikey: anonKey,
    'Content-Type': 'application/json',
    ...extra
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

/**
 * Inicia sesión con correo y contraseña en Supabase Auth.
 */
export async function signInWithEmail(email, password) {
  const cfg = await getCloudConfig();
  if (!cfg.configured) {
    throw new Error('Primero configura la URL y clave pública de Supabase.');
  }
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: buildHeaders(cfg.anonKey),
    body: JSON.stringify({ email: email.trim(), password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.msg || data.message || 'Credenciales incorrectas.';
    throw new Error(translateAuthError(msg));
  }
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
    user: { id: data.user.id, email: data.user.email }
  };
  await setMeta(SESSION_META_KEY, session);
  await setStorageMode('cloud');
  return session;
}

/**
 * Crea una cuenta nueva en Supabase Auth (si el registro está habilitado).
 */
export async function signUpWithEmail(email, password) {
  const cfg = await getCloudConfig();
  if (!cfg.configured) {
    throw new Error('Primero configura la URL y clave pública de Supabase.');
  }
  const res = await fetch(`${cfg.url}/auth/v1/signup`, {
    method: 'POST',
    headers: buildHeaders(cfg.anonKey),
    body: JSON.stringify({ email: email.trim(), password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.msg || data.message || 'No fue posible crear la cuenta.';
    throw new Error(translateAuthError(msg));
  }
  if (data.access_token && data.user) {
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
      user: { id: data.user.id, email: data.user.email }
    };
    await setMeta(SESSION_META_KEY, session);
    await setStorageMode('cloud');
    return { session, needsConfirmation: false };
  }
  return { session: null, needsConfirmation: true };
}

export async function signOut() {
  const cfg = await getCloudConfig();
  const session = await getSession();
  if (cfg.configured && session?.access_token && navigator.onLine) {
    try {
      await fetch(`${cfg.url}/auth/v1/logout`, {
        method: 'POST',
        headers: buildHeaders(cfg.anonKey, session.access_token)
      });
    } catch {
      // Ignorar fallo de red al cerrar sesión
    }
  }
  await clearSession();
  await setStorageMode(null);
}

async function ensureFreshSession() {
  const cfg = await getCloudConfig();
  const session = await getSession();
  if (!cfg.configured || !session) return null;

  if (session.expires_at && Date.now() < session.expires_at) {
    return session;
  }
  if (!session.refresh_token) return session;

  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: buildHeaders(cfg.anonKey),
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!res.ok) {
    throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
  }
  const data = await res.json();
  const refreshed = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
    user: { id: data.user?.id || session.user.id, email: data.user?.email || session.user.email }
  };
  await setMeta(SESSION_META_KEY, refreshed);
  return refreshed;
}

function translateAuthError(msg) {
  const lower = String(msg).toLowerCase();
  if (lower.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (lower.includes('email not confirmed')) return 'Debes confirmar tu correo antes de iniciar sesión.';
  if (lower.includes('already registered')) return 'Este correo ya tiene una cuenta registrada.';
  if (lower.includes('password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
  return msg;
}

/**
 * Sincronización bidireccional completa:
 * 1. Envía (PUSH) todos los elementos pendientes en `sync_queue` con upsert
 *    atómico (`Prefer: resolution=merge-duplicates`) evitando duplicados.
 * 2. Descarga (PULL) todos los registros del usuario desde Supabase.
 * 3. Detecta conflictos comparando `updated_at` y conserva la versión más reciente,
 *    registrando el conflicto en `conflicts` si hubo divergencia simultánea.
 */
export async function syncWithCloud() {
  const mode = await getStorageMode();
  if (mode !== 'cloud') {
    return { status: 'local', pushed: 0, pulled: 0, conflicts: 0 };
  }
  if (!navigator.onLine) {
    const pending = await getSyncQueue();
    return { status: 'offline', pending: pending.length, pushed: 0, pulled: 0, conflicts: 0 };
  }

  const cfg = await getCloudConfig();
  const session = await ensureFreshSession();
  if (!cfg.configured || !session?.user?.id) {
    return { status: 'unauthenticated', pushed: 0, pulled: 0, conflicts: 0 };
  }

  const userId = session.user.id;
  const headers = buildHeaders(cfg.anonKey, session.access_token);
  let pushed = 0;
  let pulled = 0;
  let conflictsFound = 0;

  // --- PASO 1: PUSH DE LA COLA OFFLINE (RESILIENTE POR ELEMENTO) ---
  const queue = await getSyncQueue();
  const pushErrors = [];
  for (const item of queue) {
    try {
      if (item.table === 'user_settings') {
        const settings = await getMeta('settings', DEFAULT_SETTINGS);
        const res = await fetch(`${cfg.url}/rest/v1/user_settings?on_conflict=user_id`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            user_id: userId,
            settings,
            updated_at: item.updated_at || new Date().toISOString()
          })
        });
        if (!res.ok) {
          const errTxt = await res.text().catch(() => '');
          throw new Error(res.status === 403
            ? 'Falta permiso SQL en user_settings (ejecuta GRANT en Supabase).'
            : `Error al sincronizar ajustes (${res.status}): ${errTxt}`);
        }
        await removeQueueItem(item.queue_id);
        pushed++;
        continue;
      }

      const record = await getOne(item.table, item.record_id);
      if (!record) {
        await removeQueueItem(item.queue_id);
        continue;
      }

      const payload = sanitizeRecordForCloud(item.table, record, userId);
      const conflictTarget = item.table === 'incomes' ? 'user_id,date' : 'id';
      const res = await fetch(`${cfg.url}/rest/v1/${item.table}?on_conflict=${conflictTarget}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        throw new Error(`No se pudo sincronizar ${item.table}: ${errTxt || res.status}`);
      }
      await removeQueueItem(item.queue_id);
      pushed++;
    } catch (itemErr) {
      pushErrors.push(itemErr.message || String(itemErr));
    }
  }

  // --- PASO 2: PULL DESDE LA NUBE Y MERGE CON DETECCIÓN DE CONFLICTOS ---
  const tables = ['incomes', 'expenses', 'loan_payments'];
  for (const table of tables) {
    const res = await fetch(`${cfg.url}/rest/v1/${table}?select=*`, {
      method: 'GET',
      headers
    });
    if (!res.ok) throw new Error(`Error al descargar ${table} desde la nube.`);
    const remoteRows = await res.json();
    const localRows = await getAll(table);
    const localById = new Map(localRows.map((r) => [r.id, r]));
    const localByDate = table === 'incomes' ? new Map(localRows.map((r) => [r.date, r])) : null;

    for (const remote of remoteRows) {
      const normalized = normalizeRemoteRecord(table, remote);
      const local = localById.get(normalized.id) || (localByDate ? localByDate.get(normalized.date) : null);

      if (!local) {
        await putOne(table, normalized);
        pulled++;
      } else {
        const remoteTime = new Date(normalized.updated_at || 0).getTime();
        const localTime = new Date(local.updated_at || 0).getTime();

        if (remoteTime > localTime) {
          // Detectar si el valor financiero difería
          if (hasMeaningfulDiff(table, local, normalized)) {
            await logConflict({
              table,
              record_id: normalized.id,
              local_updated_at: local.updated_at,
              remote_updated_at: normalized.updated_at,
              resolution: 'Se aplicó la versión más reciente de la nube'
            });
            conflictsFound++;
          }
          await putOne(table, normalized);
          pulled++;
        }
      }
    }
  }

  // Descargar ajustes del usuario
  const setRes = await fetch(`${cfg.url}/rest/v1/user_settings?select=*&limit=1`, {
    method: 'GET',
    headers
  });
  if (setRes.ok) {
    const rows = await setRes.json();
    if (rows.length > 0 && rows[0].settings) {
      const localMeta = await getOne('meta', 'settings');
      const remoteTime = new Date(rows[0].updated_at || 0).getTime();
      const localTime = new Date(localMeta?.updated_at || 0).getTime();
      if (!localMeta || remoteTime > localTime) {
        await setMeta('settings', { ...DEFAULT_SETTINGS, ...rows[0].settings });
      }
    }
  }

  if (pushErrors.length > 0) {
    throw new Error(pushErrors[0]);
  }

  const syncedAt = new Date().toISOString();
  await setMeta('last_synced_at', syncedAt);

  return { status: 'synced', syncedAt, pushed, pulled, conflicts: conflictsFound };
}

function sanitizeRecordForCloud(table, record, userId) {
  if (table === 'incomes') {
    return {
      id: record.id,
      user_id: userId,
      date: record.date,
      amount: Number(record.amount || 0),
      worked: Boolean(record.worked),
      note: String(record.note || ''),
      edit_history: Array.isArray(record.edit_history) ? record.edit_history : [],
      deleted: Boolean(record.deleted),
      created_at: record.created_at,
      updated_at: record.updated_at
    };
  }
  if (table === 'expenses') {
    return {
      id: record.id,
      user_id: userId,
      date: record.date,
      category: String(record.category || 'Otros gastos'),
      amount: Number(record.amount || 0),
      description: String(record.description || ''),
      deleted: Boolean(record.deleted),
      created_at: record.created_at,
      updated_at: record.updated_at
    };
  }
  return {
    id: record.id,
    user_id: userId,
    installment_number: record.installment_number ? Number(record.installment_number) : null,
    payment_type: record.payment_type,
    payment_date: record.payment_date,
    amount_paid: Number(record.amount_paid || 0),
    contractual_amount: Number(record.contractual_amount || 0),
    applied_to_installment: Number(record.applied_to_installment || 0),
    excess_amount: Number(record.excess_amount || 0),
    excess_application: record.excess_application || 'none',
    extra_capital_amount: Number(record.extra_capital_amount || 0),
    note: String(record.note || ''),
    deleted: Boolean(record.deleted),
    created_at: record.created_at,
    updated_at: record.updated_at
  };
}

function normalizeRemoteRecord(table, r) {
  if (table === 'incomes') {
    return {
      id: r.id,
      date: r.date,
      amount: Number(r.amount || 0),
      worked: Boolean(r.worked),
      note: r.note || '',
      edit_history: Array.isArray(r.edit_history) ? r.edit_history : [],
      deleted: Boolean(r.deleted),
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }
  if (table === 'expenses') {
    return {
      id: r.id,
      date: r.date,
      category: r.category || 'Otros gastos',
      amount: Number(r.amount || 0),
      description: r.description || '',
      deleted: Boolean(r.deleted),
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }
  return {
    id: r.id,
    installment_number: r.installment_number ? Number(r.installment_number) : null,
    payment_type: r.payment_type,
    payment_date: r.payment_date,
    amount_paid: Number(r.amount_paid || 0),
    contractual_amount: Number(r.contractual_amount || 0),
    applied_to_installment: Number(r.applied_to_installment || 0),
    excess_amount: Number(r.excess_amount || 0),
    excess_application: r.excess_application || 'none',
    extra_capital_amount: Number(r.extra_capital_amount || 0),
    note: r.note || '',
    deleted: Boolean(r.deleted),
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

function hasMeaningfulDiff(table, local, remote) {
  if (table === 'incomes') {
    return Number(local.amount) !== Number(remote.amount) || Boolean(local.worked) !== Boolean(remote.worked);
  }
  if (table === 'expenses') {
    return Number(local.amount) !== Number(remote.amount) || local.category !== remote.category;
  }
  return Number(local.amount_paid) !== Number(remote.amount_paid) || local.excess_application !== remote.excess_application;
}
