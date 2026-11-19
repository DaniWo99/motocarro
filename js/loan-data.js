/**
 * CALENDARIO OFICIAL DEL PRÉSTAMO RAPPI (36 CUOTAS)
 * Extraído y verificado matemáticamente al centavo desde la imagen original adjunta.
 *
 * Capital inicial: $8.000.000,00 COP
 * Total cuotas originales: $11.285.940,96 COP
 *   - Capital:   $8.000.000,00
 *   - Intereses: $2.852.361,56
 *   - Seguro:    $393.578,74
 *   - Comisión:  $40.000,66 (solo cuota 1)
 * Primera fecha de vencimiento prevista: 2026-12-21
 */
export const LOAN_INITIAL_CAPITAL = 8000000.00;
export const LOAN_TOTAL_INSTALLMENTS = 36;
export const LOAN_DEFAULT_FIRST_DUE_DATE = '2026-12-21';

// Parámetros inferidos del calendario oficial para simulaciones de abono a capital
// (usados únicamente como estimación claramente identificada en la UI).
export const LOAN_SIMULATION_PARAMS = {
  fixedPrincipalPlusInterest: 297290.29, // Capital + Interés constante en cuotas 1..35
  estimatedMonthlyInterestRate: 0.01775, // ~1.775% mensual vencido aproximado
  estimatedMonthlyInsuranceRate: 0.00245 // ~0.245% mensual sobre saldo aproximado
};

export const RAPPI_ORIGINAL_SCHEDULE = [
  { number: 1,  installment: 363050.95, balance: 8000000.00, capital: 110045.85, interest: 187244.44, insurance: 25760.00, fee: 40000.66 },
  { number: 2,  installment: 315437.18, balance: 7889954.15, capital: 165820.72, interest: 131469.57, insurance: 18146.89, fee: 0.00 },
  { number: 3,  installment: 316832.35, balance: 7724133.43, capital: 155595.75, interest: 141694.54, insurance: 19542.06, fee: 0.00 },
  { number: 4,  installment: 314117.67, balance: 7568537.68, capital: 175413.91, interest: 121876.38, insurance: 16827.38, fee: 0.00 },
  { number: 5,  installment: 313160.86, balance: 7393123.77, capital: 182375.57, interest: 114914.72, insurance: 15870.57, fee: 0.00 },
  { number: 6,  installment: 313875.01, balance: 7210748.20, capital: 177138.27, interest: 120152.02, insurance: 16584.72, fee: 0.00 },
  { number: 7,  installment: 314546.08, balance: 7033609.93, capital: 172207.47, interest: 125082.82, insurance: 17255.79, fee: 0.00 },
  { number: 8,  installment: 313071.52, balance: 6861402.46, capital: 182959.38, interest: 114330.91, insurance: 15781.23, fee: 0.00 },
  { number: 9,  installment: 312650.71, balance: 6678443.08, capital: 186008.02, interest: 111282.27, insurance: 15360.42, fee: 0.00 },
  { number: 10, installment: 312720.64, balance: 6492435.06, capital: 185470.48, interest: 111819.81, insurance: 15430.35, fee: 0.00 },
  { number: 11, installment: 311796.31, balance: 6306964.58, capital: 192197.93, interest: 105092.36, insurance: 14506.02, fee: 0.00 },
  { number: 12, installment: 312760.65, balance: 6114766.65, capital: 185118.61, interest: 112171.68, insurance: 15470.36, fee: 0.00 },
  { number: 13, installment: 310019.27, balance: 5929648.04, capital: 205123.05, interest: 92167.24,  insurance: 12728.98, fee: 0.00 },
  { number: 14, installment: 310895.58, balance: 5724524.99, capital: 198696.26, interest: 98594.03,  insurance: 13605.29, fee: 0.00 },
  { number: 15, installment: 310846.99, balance: 5525828.73, capital: 199021.23, interest: 98269.06,  insurance: 13556.70, fee: 0.00 },
  { number: 16, installment: 309133.56, balance: 5326807.50, capital: 211512.56, interest: 85777.73,  insurance: 11843.27, fee: 0.00 },
  { number: 17, installment: 309055.47, balance: 5115294.94, capital: 212054.61, interest: 85235.68,  insurance: 11765.18, fee: 0.00 },
  { number: 18, installment: 309319.57, balance: 4903240.33, capital: 210093.08, interest: 87197.21,  insurance: 12029.28, fee: 0.00 },
  { number: 19, installment: 307724.72, balance: 4693147.25, capital: 221716.41, interest: 75573.88,  insurance: 10434.43, fee: 0.00 },
  { number: 20, installment: 307917.39, balance: 4471430.84, capital: 220278.42, interest: 77011.87,  insurance: 10627.10, fee: 0.00 },
  { number: 21, installment: 307719.78, balance: 4251152.42, capital: 221689.55, interest: 75600.74,  insurance: 10429.49, fee: 0.00 },
  { number: 22, installment: 306249.13, balance: 4029462.87, capital: 232403.73, interest: 64886.56,  insurance: 8958.84,  fee: 0.00 },
  { number: 23, installment: 306023.53, balance: 3797059.14, capital: 234020.25, interest: 63270.04,  insurance: 8733.24,  fee: 0.00 },
  { number: 24, installment: 305758.45, balance: 3563038.89, capital: 235923.74, interest: 61366.55,  insurance: 8468.16,  fee: 0.00 },
  { number: 25, installment: 304942.65, balance: 3327115.15, capital: 241850.88, interest: 55439.41,  insurance: 7652.36,  fee: 0.00 },
  { number: 26, installment: 305096.01, balance: 3085264.27, capital: 240692.99, interest: 56597.30,  insurance: 7805.72,  fee: 0.00 },
  { number: 27, installment: 303614.72, balance: 2844571.28, capital: 251484.08, interest: 45806.21,  insurance: 6324.43,  fee: 0.00 },
  { number: 28, installment: 302856.78, balance: 2593087.20, capital: 256984.75, interest: 40305.54,  insurance: 5566.49,  fee: 0.00 },
  { number: 29, installment: 302842.43, balance: 2336102.45, capital: 257055.38, interest: 40234.91,  insurance: 5552.14,  fee: 0.00 },
  { number: 30, installment: 302231.49, balance: 2079047.07, capital: 261482.67, interest: 35807.62,  insurance: 4941.20,  fee: 0.00 },
  { number: 31, installment: 301470.69, balance: 1817564.40, capital: 267004.38, interest: 30285.91,  insurance: 4180.40,  fee: 0.00 },
  { number: 32, installment: 301213.21, balance: 1550560.02, capital: 268846.21, interest: 28444.08,  insurance: 3922.92,  fee: 0.00 },
  { number: 33, installment: 300139.97, balance: 1281713.81, capital: 276650.82, interest: 20639.47,  insurance: 2849.68,  fee: 0.00 },
  { number: 34, installment: 299601.93, balance: 1005062.99, capital: 280543.02, interest: 16747.27,  insurance: 2311.64,  fee: 0.00 },
  { number: 35, installment: 299067.78, balance: 724519.97,  capital: 284405.73, interest: 12884.56,  insurance: 1777.49,  fee: 0.00 },
  { number: 36, installment: 448179.93, balance: 440114.24,  capital: 440114.24, interest: 7087.17,   insurance: 978.52,   fee: 0.00 }
];

/**
 * Genera la fecha de vencimiento (YYYY-MM-DD) para cada cuota N (1..36)
 * a partir de la primera fecha de vencimiento (por defecto 2026-12-21).
 */
export function getInstallmentDueDate(installmentNumber, firstDueDate = LOAN_DEFAULT_FIRST_DUE_DATE) {
  const [year, month, day] = firstDueDate.split('-').map(Number);
  const totalMonths = (year * 12 + (month - 1)) + (installmentNumber - 1);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const maxDayInMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const safeDay = Math.min(day, maxDayInMonth);
  const mm = String(targetMonthIndex + 1).padStart(2, '0');
  const dd = String(safeDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}
