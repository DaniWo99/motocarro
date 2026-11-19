/**
 * MOTOR FINANCIERO DE MI MOTOCARRO
 * - KPIs de Dashboard (flujo de caja vs. utilidad neta real)
 * - Estado de las 36 cuotas de Rappi, pagos parciales, excedentes y abonos a capital
 * - Simulación estimada de recálculo por abonos extraordinarios
 * - Estadísticas y proyecciones basadas en los días laborales configurados
 */

import {
  LOAN_INITIAL_CAPITAL,
  LOAN_SIMULATION_PARAMS,
  RAPPI_ORIGINAL_SCHEDULE,
  getInstallmentDueDate
} from './loan-data.js';
import {
  DEFAULT_SETTINGS,
  getBogotaNow,
  formatDateStr,
  isScheduledWorkDay,
  getExpectedDailyRate
} from './utils.js';

/**
 * Calcula el estado completo del préstamo Rappi a partir del calendario oficial
 * y todos los pagos / abonos registrados por el usuario.
 */
export function computeLoanState(loanPayments = [], settings = DEFAULT_SETTINGS, todayStr = null) {
  const activePayments = loanPayments.filter((p) => !p.deleted);
  const firstDueDate = settings.firstDueDate || '2026-12-21';
  const today = todayStr || getBogotaNow().dateStr;

  // Agrupar pagos aplicados a cada cuota (1..36)
  const paymentsByInst = new Map();
  let totalExtraCapital = 0;
  let totalPaidToRappi = 0;
  let totalContractualPayments = 0;
  let totalOtherCharges = 0;

  for (const p of activePayments) {
    const paid = Number(p.amount_paid || 0);
    totalPaidToRappi += paid;

    if (p.payment_type === 'extra_capital') {
      totalExtraCapital += Number(p.extra_capital_amount || paid);
    } else if (p.installment_number) {
      const n = Number(p.installment_number);
      const applied = Number(p.applied_to_installment || Math.min(paid, Number(p.contractual_amount || paid)));
      totalContractualPayments += applied;
      if (!paymentsByInst.has(n)) paymentsByInst.set(n, []);
      paymentsByInst.get(n).push(p);

      const excess = Number(p.excess_amount || 0);
      if (excess > 0) {
        if (p.excess_application === 'extra_capital') {
          totalExtraCapital += Number(p.extra_capital_amount || excess);
        } else if (p.excess_application === 'next_installment' && n < 36) {
          // Aplicar excedente como abono parcial a la cuota siguiente
          const nextNum = n + 1;
          if (!paymentsByInst.has(nextNum)) paymentsByInst.set(nextNum, []);
          paymentsByInst.get(nextNum).push({
            ...p,
            applied_to_installment: excess,
            _fromExcessOf: n
          });
          totalContractualPayments += excess;
        } else if (p.excess_application === 'other_charges') {
          totalOtherCharges += excess;
        }
      }
    }
  }

  let paidInstallmentsCount = 0;
  let partialInstallmentsCount = 0;
  let overdueInstallmentsCount = 0;
  let amortizedCapitalFromInstallments = 0;
  let financialCostPaid = totalOtherCharges; // Intereses + Seguro + Comisión pagados

  const installments = RAPPI_ORIGINAL_SCHEDULE.map((row) => {
    const dueDate = getInstallmentDueDate(row.number, firstDueDate);
    const list = paymentsByInst.get(row.number) || [];
    const paidForThis = list.reduce((acc, p) => acc + Number(p.applied_to_installment || 0), 0);
    const remaining = Math.max(0, Number((row.installment - paidForThis).toFixed(2)));
    const ratio = Math.min(1, row.installment > 0 ? paidForThis / row.installment : 0);

    // Capital y costo financiero proporcionales al avance pagado de la cuota
    amortizedCapitalFromInstallments += row.capital * ratio;
    financialCostPaid += (row.interest + row.insurance + row.fee) * ratio;

    let status = 'pending';
    if (remaining <= 1) {
      status = 'paid';
      paidInstallmentsCount++;
    } else if (paidForThis > 0) {
      status = dueDate < today ? 'overdue' : 'partial';
      partialInstallmentsCount++;
      if (dueDate < today) overdueInstallmentsCount++;
    } else if (dueDate < today) {
      status = 'overdue';
      overdueInstallmentsCount++;
    }

    const latestPayment = list
      .filter((p) => !p._fromExcessOf)
      .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''))[0];

    return {
      ...row,
      dueDate,
      status,
      paidAmount: Number(paidForThis.toFixed(2)),
      remainingAmount: remaining,
      actualPaymentDate: latestPayment?.payment_date || null,
      payments: list
    };
  });

  const pendingCapital = Math.max(
    0,
    Number((LOAN_INITIAL_CAPITAL - amortizedCapitalFromInstallments - totalExtraCapital).toFixed(2))
  );

  const nextInstallment = installments.find((i) => i.status !== 'paid') || null;
  const originalEndDate = installments[installments.length - 1].dueDate;

  // Simulación estimada cuando existen abonos extraordinarios a capital
  const simulation = simulateUpdatedSchedule(installments, pendingCapital, totalExtraCapital, firstDueDate);

  const originalTotalLoan = Number(
    RAPPI_ORIGINAL_SCHEDULE.reduce((s, r) => s + r.installment, 0).toFixed(2)
  );
  const originalFinancialCost = Number((originalTotalLoan - LOAN_INITIAL_CAPITAL).toFixed(2));
  const pendingTotalOriginal = Number(
    installments.reduce((s, i) => s + i.remainingAmount, 0).toFixed(2)
  );
  const pendingTotalDebt = simulation.hasExtraCapital
    ? simulation.simulatedRemainingTotal
    : pendingTotalOriginal;
  const pendingFinancialCost = Math.max(0, Number((pendingTotalDebt - pendingCapital).toFixed(2)));

  return {
    initialCapital: LOAN_INITIAL_CAPITAL,
    originalTotalLoan,
    originalFinancialCost,
    pendingCapital,
    pendingTotalOriginal,
    pendingTotalDebt,
    pendingFinancialCost,
    amortizedCapital: Number((amortizedCapitalFromInstallments + totalExtraCapital).toFixed(2)),
    totalExtraCapital: Number(totalExtraCapital.toFixed(2)),
    totalPaidToRappi: Number(totalPaidToRappi.toFixed(2)),
    totalContractualPayments: Number(totalContractualPayments.toFixed(2)),
    financialCostPaid: Number(financialCostPaid.toFixed(2)),
    paidInstallmentsCount,
    partialInstallmentsCount,
    overdueInstallmentsCount,
    totalInstallments: installments.length,
    nextInstallment,
    originalEndDate,
    installments,
    simulation
  };
}

/**
 * Simulación estimada del calendario actualizado tras abonos extraordinarios a capital.
 * Mantiene la cuota fija capital+interés del plan original ($297.290,29) y aplica
 * las tasas mensuales aproximadas inferidas del plan original.
 * SIEMPRE se presenta como "Simulación estimada — no constituye saldo oficial de Rappi".
 */
function simulateUpdatedSchedule(installments, currentPendingCapital, totalExtraCapital, firstDueDate) {
  const unpaid = installments.filter((i) => i.status !== 'paid');
  const originalRemainingInterest = unpaid.reduce((s, i) => s + i.interest, 0);
  const originalRemainingInsurance = unpaid.reduce((s, i) => s + i.insurance, 0);
  const originalRemainingTotal = unpaid.reduce((s, i) => s + i.remainingAmount, 0);

  if (totalExtraCapital <= 0 || currentPendingCapital <= 0 || unpaid.length === 0) {
    return {
      hasExtraCapital: totalExtraCapital > 0,
      isSimulated: false,
      rows: unpaid.map((u) => ({
        number: u.number,
        dueDate: u.dueDate,
        balance: u.balance,
        capital: u.capital,
        interest: u.interest,
        insurance: u.insurance,
        installment: u.installment
      })),
      estimatedEndDate: currentPendingCapital <= 0 ? 'Pagado' : installments[installments.length - 1].dueDate,
      monthsSaved: currentPendingCapital <= 0 ? unpaid.length : 0,
      estimatedInterestSaved: currentPendingCapital <= 0 ? Number(originalRemainingInterest.toFixed(2)) : 0,
      estimatedTotalSaved: currentPendingCapital <= 0 ? Number((originalRemainingInterest + originalRemainingInsurance).toFixed(2)) : 0,
      originalRemainingTotal: Number(originalRemainingTotal.toFixed(2)),
      simulatedRemainingTotal: currentPendingCapital <= 0 ? 0 : Number(originalRemainingTotal.toFixed(2))
    };
  }

  const rInt = LOAN_SIMULATION_PARAMS.estimatedMonthlyInterestRate;
  const rIns = LOAN_SIMULATION_PARAMS.estimatedMonthlyInsuranceRate;
  const fixedCI = LOAN_SIMULATION_PARAMS.fixedPrincipalPlusInterest;

  const startNum = unpaid[0].number;
  let bal = currentPendingCapital;
  const simRows = [];
  let simInterest = 0;
  let simInsurance = 0;
  let simTotal = 0;

  for (let idx = 0; idx < unpaid.length && bal > 1; idx++) {
    const instNum = startNum + idx;
    const dueDate = getInstallmentDueDate(instNum, firstDueDate);
    const interest = Number((bal * rInt).toFixed(2));
    const insurance = Number((bal * rIns).toFixed(2));
    let capital = Number((fixedCI - interest).toFixed(2));

    if (capital <= 0) capital = Number((bal / (unpaid.length - idx)).toFixed(2));
    if (capital >= bal || idx === unpaid.length - 1) {
      capital = Number(bal.toFixed(2));
    }

    const totalQuota = Number((capital + interest + insurance).toFixed(2));
    simRows.push({
      number: instNum,
      dueDate,
      balance: Number(bal.toFixed(2)),
      capital,
      interest,
      insurance,
      installment: totalQuota
    });

    simInterest += interest;
    simInsurance += insurance;
    simTotal += totalQuota;
    bal = Math.max(0, Number((bal - capital).toFixed(2)));
  }

  const monthsSaved = Math.max(0, unpaid.length - simRows.length);
  const estimatedEndDate = simRows.length > 0 ? simRows[simRows.length - 1].dueDate : 'Pagado';

  return {
    hasExtraCapital: true,
    isSimulated: true,
    rows: simRows,
    estimatedEndDate,
    monthsSaved,
    estimatedInterestSaved: Math.max(0, Number((originalRemainingInterest - simInterest).toFixed(2))),
    estimatedTotalSaved: Math.max(
      0,
      Number(((originalRemainingInterest + originalRemainingInsurance) - (simInterest + simInsurance)).toFixed(2))
    ),
    originalRemainingTotal: Number(originalRemainingTotal.toFixed(2)),
    simulatedRemainingTotal: Number(simTotal.toFixed(2))
  };
}

/**
 * Calcula todos los KPIs, flujo de caja vs utilidad real, estadísticas y proyecciones.
 */
export function computeFinancialOverview(incomes = [], expenses = [], loanPayments = [], settings = DEFAULT_SETTINGS) {
  const now = getBogotaNow();
  const todayStr = now.dateStr;
  const currentMonthPrefix = `${now.year}-${String(now.month).padStart(2, '0')}`;
  const currentYearPrefix = `${now.year}-`;

  const activeIncomes = incomes.filter((r) => !r.deleted);
  const activeExpenses = expenses.filter((r) => !r.deleted);
  const activeLoanPayments = loanPayments.filter((r) => !r.deleted);

  const loan = computeLoanState(activeLoanPayments, settings, todayStr);

  // Totales de ingresos
  const totalGrossIncome = activeIncomes.reduce((s, r) => s + Number(r.amount || 0), 0);
  const currentMonthIncome = activeIncomes
    .filter((r) => r.date.startsWith(currentMonthPrefix))
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const currentYearIncome = activeIncomes
    .filter((r) => r.date.startsWith(currentYearPrefix))
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const todayIncome = activeIncomes
    .filter((r) => r.date === todayStr)
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  // Últimos 7 días (semana reciente)
  const todayDate = new Date(now.year, now.month - 1, now.day);
  const weekStartDate = new Date(todayDate);
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStartStr = formatDateStr(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth() + 1,
    weekStartDate.getDate()
  );
  const weeklyIncome = activeIncomes
    .filter((r) => r.date >= weekStartStr && r.date <= todayStr)
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  // Promedio diario (solo sobre días trabajados con monto > 0)
  const workedDays = activeIncomes.filter((r) => r.worked && Number(r.amount) > 0);
  const avgDailyIncome = workedDays.length > 0 ? totalGrossIncome / workedDays.length : 0;

  // Ingresos agrupados por mes (YYYY-MM)
  const monthlyMap = new Map();
  for (const r of activeIncomes) {
    const ym = r.date.slice(0, 7);
    monthlyMap.set(ym, (monthlyMap.get(ym) || 0) + Number(r.amount || 0));
  }
  const activeMonthsCount = monthlyMap.size;
  const avgMonthlyIncome = activeMonthsCount > 0 ? totalGrossIncome / activeMonthsCount : 0;

  // Gastos operativos
  const totalExpenses = activeExpenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const currentMonthExpenses = activeExpenses
    .filter((r) => r.date.startsWith(currentMonthPrefix))
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const expensesByCategory = {};
  for (const e of activeExpenses) {
    expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + Number(e.amount || 0);
  }

  // Flujo de caja vs. Utilidad real del negocio
  // Flujo de caja (Dinero disponible) = Ingresos - Gastos operativos - Todos los pagos a Rappi (cuotas + abonos)
  const availableCash = totalGrossIncome - totalExpenses - loan.totalPaidToRappi;

  // Utilidad neta real = Ingresos - Gastos operativos - Costo financiero del préstamo (intereses + seguro + comisión)
  // (El capital amortizado reduce deuda, no es pérdida operativa)
  const netBusinessProfit = totalGrossIncome - totalExpenses - loan.financialCostPaid;

  // --- PROYECCIONES BASADAS EN EL CALENDARIO CONFIGURADO ---
  const projections = computeProjections(activeIncomes, loan, settings, now);

  // Series para gráficos
  const charts = buildChartSeries(activeIncomes, activeLoanPayments, now);

  // Últimos movimientos unificados
  const recentMovements = buildUnifiedHistory(activeIncomes, activeExpenses, activeLoanPayments).slice(0, 8);

  return {
    now,
    totalGrossIncome,
    currentMonthIncome,
    currentYearIncome,
    weeklyIncome,
    todayIncome,
    workedDaysCount: workedDays.length,
    avgDailyIncome,
    avgMonthlyIncome,
    totalExpenses,
    currentMonthExpenses,
    expensesByCategory,
    availableCash,
    netBusinessProfit,
    loan,
    projections,
    charts,
    recentMovements
  };
}

/**
 * Calcula proyecciones realistas contando exactamente los días laborales configurados
 * en cada mes (incluyendo regla especial de diciembre).
 */
function computeProjections(activeIncomes, loan, settings, now) {
  const currentMonthPrefix = `${now.year}-${String(now.month).padStart(2, '0')}`;
  const recordedDatesThisMonth = new Set(
    activeIncomes.filter((r) => r.date.startsWith(currentMonthPrefix)).map((r) => r.date)
  );
  const recordedIncomeThisMonth = activeIncomes
    .filter((r) => r.date.startsWith(currentMonthPrefix))
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  // Contar días laborales restantes de este mes (desde hoy si no registrado hasta fin de mes)
  const daysInMonth = new Date(now.year, now.month, 0).getDate();
  let remainingWorkDaysThisMonth = 0;
  let expectedRemainingThisMonth = 0;

  for (let d = now.day; d <= daysInMonth; d++) {
    const ds = formatDateStr(now.year, now.month, d);
    if (recordedDatesThisMonth.has(ds)) continue;
    if (isScheduledWorkDay(ds, settings)) {
      remainingWorkDaysThisMonth++;
      expectedRemainingThisMonth += getExpectedDailyRate(ds, settings);
    }
  }

  const projectedThisMonthIncome = recordedIncomeThisMonth + expectedRemainingThisMonth;
  const nextQuotaAmount = loan.nextInstallment ? loan.nextInstallment.remainingAmount : 0;
  const projectedLeftAfterQuota = projectedThisMonthIncome - nextQuotaAmount;

  // Proyección 12 meses y 36 meses contando días reales de cada mes a partir del mes actual
  const estimateMonthsRange = (monthCount) => {
    let total = 0;
    let totalWorkDays = 0;
    for (let i = 0; i < monthCount; i++) {
      const mTotal = (now.year * 12 + (now.month - 1)) + i;
      const y = Math.floor(mTotal / 12);
      const m = (mTotal % 12) + 1;
      const dim = new Date(y, m, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const ds = formatDateStr(y, m, d);
        if (isScheduledWorkDay(ds, settings)) {
          totalWorkDays++;
          total += getExpectedDailyRate(ds, settings);
        }
      }
    }
    return { total, totalWorkDays };
  };

  const year1 = estimateMonthsRange(12);
  const months36 = estimateMonthsRange(36);

  return {
    projectedThisMonthIncome,
    remainingWorkDaysThisMonth,
    projectedLeftAfterQuota,
    nextQuotaAmount,
    estimatedLoanEndDate: loan.simulation.hasExtraCapital
      ? loan.simulation.estimatedEndDate
      : loan.originalEndDate,
    isLoanEndSimulated: loan.simulation.isSimulated,
    year1ProjectedIncome: year1.total,
    year1WorkDays: year1.totalWorkDays,
    months36ProjectedIncome: months36.total,
    months36WorkDays: months36.totalWorkDays
  };
}

function buildChartSeries(activeIncomes, activeLoanPayments, now) {
  // 1. Ingresos diarios del mes actual
  const daysInMonth = new Date(now.year, now.month, 0).getDate();
  const dailyMap = new Map();
  const prefix = `${now.year}-${String(now.month).padStart(2, '0')}`;
  for (const r of activeIncomes) {
    if (r.date.startsWith(prefix)) {
      dailyMap.set(r.date, Number(r.amount || 0));
    }
  }
  const dailyLabels = [];
  const dailyValues = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = formatDateStr(now.year, now.month, d);
    dailyLabels.push(String(d));
    dailyValues.push(dailyMap.get(ds) || 0);
  }

  // 2. Ingresos mensuales y comparación Ingresos vs Cuotas (últimos 6 meses)
  const monthLabels = [];
  const monthlyIncomeValues = [];
  const monthlyLoanValues = [];

  for (let offset = 5; offset >= 0; offset--) {
    const mTotal = (now.year * 12 + (now.month - 1)) - offset;
    const y = Math.floor(mTotal / 12);
    const m = (mTotal % 12) + 1;
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const shortNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    monthLabels.push(`${shortNames[m - 1]} ${String(y).slice(2)}`);

    const inc = activeIncomes
      .filter((r) => r.date.startsWith(ym))
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const loanPaid = activeLoanPayments
      .filter((p) => (p.payment_date || '').startsWith(ym))
      .reduce((s, p) => s + Number(p.amount_paid || 0), 0);

    monthlyIncomeValues.push(inc);
    monthlyLoanValues.push(loanPaid);
  }

  return {
    dailyLabels,
    dailyValues,
    monthLabels,
    monthlyIncomeValues,
    monthlyLoanValues
  };
}

/**
 * Construye el historial unificado de todos los movimientos (incluyendo correcciones).
 */
export function buildUnifiedHistory(incomes = [], expenses = [], loanPayments = []) {
  const items = [];

  for (const r of incomes) {
    if (r.deleted) continue;
    items.push({
      id: r.id,
      type: 'income',
      typeLabel: 'Ingreso',
      date: r.date,
      category: r.worked ? 'Alquiler diario' : 'Día sin trabajar',
      amount: Number(r.amount || 0),
      sign: '+',
      description: r.note || (r.worked ? 'Pago del conductor' : 'Vehículo sin operación'),
      created_at: r.created_at,
      updated_at: r.updated_at,
      raw: r
    });

    if (Array.isArray(r.edit_history)) {
      for (const ed of r.edit_history) {
        items.push({
          id: `${r.id}_edit_${ed.edited_at}`,
          type: 'correction',
          typeLabel: 'Corrección',
          date: r.date,
          category: 'Edición de ingreso',
          amount: Number(ed.new_amount || 0),
          sign: '~',
          description: `Cambio de ${ed.previous_amount} a ${ed.new_amount}${ed.reason ? ` (${ed.reason})` : ''}`,
          created_at: ed.edited_at,
          updated_at: ed.edited_at,
          raw: ed
        });
      }
    }
  }

  for (const e of expenses) {
    if (e.deleted) continue;
    items.push({
      id: e.id,
      type: 'expense',
      typeLabel: 'Gasto',
      date: e.date,
      category: e.category,
      amount: Number(e.amount || 0),
      sign: '-',
      description: e.description || e.category,
      created_at: e.created_at,
      updated_at: e.updated_at,
      raw: e
    });
  }

  for (const p of loanPayments) {
    if (p.deleted) continue;
    const isExtra = p.payment_type === 'extra_capital';
    items.push({
      id: p.id,
      type: isExtra ? 'extra_capital' : 'loan_payment',
      typeLabel: isExtra ? 'Abono a capital' : `Cuota #${p.installment_number}`,
      date: p.payment_date,
      category: isExtra ? 'Préstamo Rappi (Capital)' : 'Préstamo Rappi',
      amount: Number(p.amount_paid || 0),
      sign: '-',
      description:
        p.note ||
        (isExtra
          ? 'Abono extraordinario a capital'
          : p.excess_amount > 0
            ? `Cuota #${p.installment_number} + excedente (${p.excess_application})`
            : `Pago cuota #${p.installment_number}`),
      created_at: p.created_at,
      updated_at: p.updated_at,
      raw: p
    });
  }

  items.sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });

  return items;
}
