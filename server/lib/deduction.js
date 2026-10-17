// Late-deduction calculation rules.

/**
 * Compute the deduction for one late attendance record.
 *
 * rules = {
 *   mode: 'per_occurrence' | 'per_minute_block',
 *   perOccurrence: rupiah per late event,
 *   perBlock: rupiah per block of late minutes,
 *   blockMinutes: size of one block in minutes,
 * }
 * lateMinutes: minutes late beyond (work_start + tolerance).
 * isLate: whether the record counts as late (defaults to lateMinutes > 0).
 *         Needed because legacy/manual rows may be marked 'Terlambat' with 0 minutes.
 *
 * Returns { deduction, blocks }.
 */
export function computeLateDeduction(lateMinutes, rules = {}, { isLate } = {}) {
  const minutes = Math.max(0, Number(lateMinutes) || 0);
  const late = isLate === undefined ? minutes > 0 : !!isLate;
  if (!late) return { deduction: 0, blocks: 0 };

  if (rules.mode === 'per_minute_block') {
    const blockMinutes = Math.max(1, Number(rules.blockMinutes) || 10);
    const perBlock = Math.max(0, Number(rules.perBlock) || 0);
    // Any started block counts (ceil). With 0 minutes recorded, charge one block.
    const blocks = Math.max(1, Math.ceil(minutes / blockMinutes));
    return { deduction: blocks * perBlock, blocks };
  }

  // Default: flat amount per late occurrence (independent of minutes).
  return { deduction: Math.max(0, Number(rules.perOccurrence) || 0), blocks: 0 };
}

/** Read deduction rules from a settings accessor. */
export function lateRulesFromSettings(getSetting) {
  return {
    mode: String(getSetting('late_deduction_mode', 'per_occurrence')) === 'per_minute_block'
      ? 'per_minute_block'
      : 'per_occurrence',
    perOccurrence: Number(getSetting('late_deduction_per_occurrence', '0')) || 0,
    perBlock: Number(getSetting('late_deduction_per_block', '0')) || 0,
    blockMinutes: Number(getSetting('late_deduction_block_minutes', '10')) || 10,
  };
}
