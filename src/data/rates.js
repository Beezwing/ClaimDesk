// JMDA rates — all amounts in JMD

export const GRADES = [
  { id: 'mo3',   label: 'HPC/MO 3',       category: 'doctor', crossCoverageEligible: true },
  { id: 'mo2',   label: 'HPC/MO 2',       category: 'doctor', crossCoverageEligible: true },
  { id: 'mo1',   label: 'HPC/MO 1',       category: 'doctor', crossCoverageEligible: true },
  { id: 'sho',   label: 'Senior House Officer (SHO)', category: 'doctor', crossCoverageEligible: true },
  { id: 'int1',  label: 'Intern I',        category: 'doctor', crossCoverageEligible: false },
  { id: 'locum', label: 'Locum Intern',    category: 'doctor', crossCoverageEligible: false },
  // Registered Nurses — HPC/RN salary scales (MOF 26.5.23)
  { id: 'rn8', label: 'HPC/RN 8', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn7', label: 'HPC/RN 7', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn6', label: 'HPC/RN 6', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn5', label: 'HPC/RN 5', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn4', label: 'HPC/RN 4', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn3', label: 'HPC/RN 3', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn2', label: 'HPC/RN 2', category: 'nurse', crossCoverageEligible: false },
  { id: 'rn1', label: 'HPC/RN 1', category: 'nurse', crossCoverageEligible: false },
]

// Annual basic salary scales (JMD) — JMDA 2023-2025 document
// Each grade has 8 incremental steps (min → max). SHO/Interns have a single point.
// Source: JMDA Health Professional Category (HPC) salary scales
export const SALARY_SCALES = {
  // With Effect from April 1, 2024 (current as of Oct 2024)
  '2024': {
    mo3:   [8921315, 9144348, 9372956, 9607280, 9847462, 10093649, 10345990, 10604640],
    mo2:   [7885142, 8082271, 8284328, 8491436, 8703722,  8921315,  9144348,  9372956],
    mo1:   [6799334, 6969317, 7143550, 7322139, 7505192,  7692822,  7885142,  8082271],
    sho:   [6799334],
    int1:  [6119400],
    locum: [5507460],
    // Registered Nurses — MOF Salary Scale 26.5.23, With effect from April 1, 2024
    rn8:   [10000000, 11886858],
    rn7:   [ 8921315, 10604640],
    rn6:   [ 7885142,  9372956],
    rn5:   [ 6799334,  8082271],
    rn4:   [ 5863044,  6969317],
    rn3:   [ 5055684,  6009620],
    rn2:   [ 4359501,  5182077],
    rn1:   [ 3241533,  3853164],
  },
  // With Effect from April 1, 2023
  '2023': {
    mo3:   [8252216, 8458522, 8669985, 8886734, 9108903, 9336625, 9570041, 9809292],
    mo2:   [7293757, 7476101, 7663003, 7854578, 8050943, 8252216, 8458522, 8669985],
    mo1:   [6289384, 6446618, 6607784, 6772978, 6942303, 7115860, 7293757, 7476101],
    sho:   [6289384],
    int1:  [5660445],
    locum: [5094401],
    // Registered Nurses — With effect from April 1, 2023
    rn8:   [9250000, 10995343],
    rn7:   [8252216,  9809292],
    rn6:   [7293757,  8669985],
    rn5:   [6289384,  7476101],
    rn4:   [5423316,  6446618],
    rn3:   [4676508,  5558899],
    rn2:   [4032538,  4793421],
    rn1:   [2998418,  3564126],
  },
  // Existing (pre-2023) rates for reference
  'existing': {
    mo3:   [3061486, 3138023, 3216474, 3296885, 3379308, 3463790, 3550385, 3639145],
    mo2:   [2634885, 2700757, 2768276, 2837483, 2908420, 2981130, 3055659, 3132050],
    mo1:   [2254291, 2310648, 2368414, 2427624, 2488315, 2550523, 2614286, 2679643],
    sho:   [2254291],
    int1:  [1803432],
    locum: [1767364],
    // Registered Nurses — Previous rates
    rn8:   [3568177, 4241442],
    rn7:   [3061485, 3639144],
    rn6:   [2634885, 3132050],
    rn5:   [2254290, 2679643],
    rn4:   [1944796, 2311731],
    rn3:   [1689672, 2008489],
    rn2:   [1453516, 1727774],
    rn1:   [1146743, 1363117],
  },
}

// Get annual salary for a grade at a given step (0-indexed) and scale year
export function getAnnualSalary(gradeId, scaleYear = '2024', step = 0) {
  const scale = SALARY_SCALES[scaleYear]?.[gradeId]
  if (!scale) return 0
  const idx = Math.min(step, scale.length - 1)
  return scale[idx]
}

// Get monthly base salary
export function getMonthlySalary(gradeId, scaleYear = '2024', step = 0) {
  return getAnnualSalary(gradeId, scaleYear, step) / 12
}

// Rostered duty hourly rates — standard (single hospital)
export const ROSTERED_STANDARD = {
  mo3:   { weekday: 2006.07, saturday: 2607.89, holiday: 2708.19 },
  mo2:   { weekday: 1726.53, saturday: 2244.49, holiday: 2330.82 },
  mo1:   { weekday: 1477.14, saturday: 1920.29, holiday: 1994.15 },
  sho:   { weekday: 1354.74, saturday: 1761.16, holiday: 1828.90 },
  int1:  { weekday: 1083.79, saturday: 1408.93, holiday: 1463.12 },
  locum: { weekday: 1062.12, saturday: 1380.75, holiday: 1433.86 },
  // Registered Nurses — Standby/On-Call rates from MOF Salary Scale 26.5.23
  // Annual on-call ÷ 52 weeks ÷ 16 hrs = effective hourly rate per rostered shift
  // RN 8–6: $1,750,788 / $1,502,124 / $1,292,772 pa on-call
  // RN 5–4: $1,106,040 / $954,252 pa | RN 3–1: $828,984 / $713,232 / $562,692 pa
  rn8:   { weekday: 2102.87, saturday: 2733.74, holiday: 2838.34 },
  rn7:   { weekday: 1803.99, saturday: 2345.18, holiday: 2435.65 },
  rn6:   { weekday: 1552.85, saturday: 2018.71, holiday: 2096.51 },
  rn5:   { weekday: 1328.17, saturday: 1726.62, holiday: 1793.27 },
  rn4:   { weekday: 1145.74, saturday: 1489.47, holiday: 1546.64 },
  rn3:   { weekday:  995.17, saturday: 1293.72, holiday: 1343.17 },
  rn2:   { weekday:  856.29, saturday: 1113.18, holiday: 1155.74 },
  rn1:   { weekday:  675.83, saturday:  878.57, holiday:  912.31 },
}

// Rostered duty hourly rates — cross coverage (two hospitals)
export const ROSTERED_CROSS = {
  mo3: { weekday: 2507.58, saturday: 3259.86, holiday: 3385.24 },
  mo2: { weekday: 2158.17, saturday: 2805.62, holiday: 2913.52 },
  mo1: { weekday: 1846.43, saturday: 2400.36, holiday: 2492.68 },
  sho: { weekday: 1691.41, saturday: 2198.83, holiday: 2283.40 },
}

// Sessional rates — per 4-hour block
// MO1 and above (and nurses TBD — using MO1 rates as placeholder)
const SESSION_MO1_ABOVE = {
  ward:     { weekday: 9034.75,  saturday: 11745.18, holiday: 12196.91 },
  casualty: { weekday: 15359.07, saturday: 19966.78, holiday: 20734.71 },
}

// SHO sessional rates
const SESSION_SHO = {
  ward:     { weekday: 7090.30, saturday: 9217.38, holiday: 9571.90 },
  casualty: { weekday: 12053.50, saturday: 15669.55, holiday: 16272.23 },
}

// Cross-coverage sessional rates (MO1 and interns, Type A & B hospitals)
export const SESSION_CROSS_COVERAGE = {
  weekday: 3709.91, saturday: 4822.90, holiday: 5008.40,
}

export function getSessionRates(gradeId) {
  if (gradeId === 'sho') return SESSION_SHO
  return SESSION_MO1_ABOVE
}

export function getRosteredHourlyRate(gradeId, dayType, crossCoverage) {
  if (crossCoverage && ROSTERED_CROSS[gradeId]) {
    return ROSTERED_CROSS[gradeId][dayType]
  }
  return ROSTERED_STANDARD[gradeId]?.[dayType] ?? 0
}

// Rostered duty is always 16 hours (4PM → 8AM)
export const ROSTERED_HOURS = 16

// Deductions
export const TAX_RATE = 0.33
export const NIS_RATE = 0.025
export const NHT_RATE = 0.02
export const EDUCATION_TAX_RATE = 0.0225 // employee portion

export const TAXI_ALLOWANCE = 2000 // JMD per qualifying session — confirm with client
