/**
 * CAPA DE ALMACENAMIENTO LOCAL PERMANENTE (IndexedDB)
 * Almacena ingresos, gastos, pagos del préstamo, ajustes, cola offline
 * y registro de conflictos de sincronización.
 */

const DB_NAME = 'MiMotocarroDB';
const DB_VERSION = 1;

const STORES = ['incomes', 'expenses', 'loan_payments', 'sync_queue', 'meta', 'conflicts'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('incomes')) {
        const s = db.createObjectStore('incomes', { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('loan_payments')) {
        const s = db.createObjectStore('loan_payments', { keyPath: 'id' });
        s.createIndex('payment_date', 'payment_date', { unique: false });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'queue_id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('conflicts')) {
        db.createObjectStore('conflicts', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txPromise(storeName, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
      })
  );
}

export function getAll(storeName) {
  return txPromise(storeName, 'readonly', (s) => s.getAll());
}

export function getOne(storeName, key) {
  return txPromise(storeName, 'readonly', (s) => s.get(key));
}

export function putOne(storeName, record) {
  return txPromise(storeName, 'readwrite', (s) => s.put(record));
}

export function deleteOne(storeName, key) {
  return txPromise(storeName, 'readwrite', (s) => s.delete(key));
}

export function clearStore(storeName) {
  return txPromise(storeName, 'readwrite', (s) => s.clear());
}

export async function getMeta(key, fallback = null) {
  const row = await getOne('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return putOne('meta', { key, value, updated_at: new Date().toISOString() });
}

/**
 * Encola un registro para sincronización con la nube.
 * Usa queue_id = `${table}:${id}` para coalescer múltiples ediciones offline
 * del mismo registro y evitar duplicados en la cola.
 */
export async function enqueueSync(table, record) {
  const queue_id = `${table}:${record.id || 'settings'}`;
  await putOne('sync_queue', {
    queue_id,
    table,
    record_id: record.id || 'settings',
    updated_at: record.updated_at || new Date().toISOString()
  });
}

export async function removeQueueItem(queueId) {
  await deleteOne('sync_queue', queueId);
}

export async function getSyncQueue() {
  return getAll('sync_queue');
}

export async function logConflict(conflict) {
  await putOne('conflicts', {
    id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    resolved_at: new Date().toISOString(),
    ...conflict
  });
}

export async function getConflicts() {
  const list = await getAll('conflicts');
  return list.sort((a, b) => (b.resolved_at || '').localeCompare(a.resolved_at || ''));
}

export async function clearAllData() {
  for (const s of STORES) {
    await clearStore(s);
  }
}

/**
 * Exporta todos los datos del usuario (excluyendo registros eliminados si se desea)
 * en un objeto estructurado listo para respaldo JSON.
 */
export async function exportFullBackup(settings) {
  const [incomes, expenses, loan_payments] = await Promise.all([
    getAll('incomes'),
    getAll('expenses'),
    getAll('loan_payments')
  ]);
  return {
    app: 'Mi Motocarro',
    schema_version: 1,
    exported_at: new Date().toISOString(),
    settings,
    incomes: incomes.filter((r) => !r.deleted),
    expenses: expenses.filter((r) => !r.deleted),
    loan_payments: loan_payments.filter((r) => !r.deleted)
  };
}

/**
 * Restaura una copia de seguridad JSON sin duplicar registros existentes
 * (unifica ingresos por fecha para evitar duplicidad diaria y demás por id).
 */
export async function restoreFromBackup(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('El archivo de respaldo no tiene un formato válido.');
  }
  const incomes = Array.isArray(payload.incomes) ? payload.incomes : [];
  const expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
  const loanPayments = Array.isArray(payload.loan_payments) ? payload.loan_payments : [];

  const existingIncomes = await getAll('incomes');
  const incomeByDate = new Map(existingIncomes.map((r) => [r.date, r]));

  let count = 0;
  for (const item of incomes) {
    if (!item.id || !item.date) continue;
    const sameDate = incomeByDate.get(item.date);
    const record = {
      ...item,
      id: sameDate ? sameDate.id : item.id,
      deleted: false,
      updated_at: new Date().toISOString()
    };
    await putOne('incomes', record);
    await enqueueSync('incomes', record);
    count++;
  }

  for (const item of expenses) {
    if (!item.id || !item.date) continue;
    const record = { ...item, deleted: false, updated_at: new Date().toISOString() };
    await putOne('expenses', record);
    await enqueueSync('expenses', record);
    count++;
  }

  for (const item of loanPayments) {
    if (!item.id || !item.payment_date) continue;
    const record = { ...item, deleted: false, updated_at: new Date().toISOString() };
    await putOne('loan_payments', record);
    await enqueueSync('loan_payments', record);
    count++;
  }

  if (payload.settings && typeof payload.settings === 'object') {
    await setMeta('settings', payload.settings);
    await enqueueSync('user_settings', { id: 'settings', updated_at: new Date().toISOString() });
  }

  return count;
}
