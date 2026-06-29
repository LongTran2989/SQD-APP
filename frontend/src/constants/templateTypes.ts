// frontend/src/constants/templateTypes.ts
// ──────────────────────────────────────────────────────────────────────────────
// Hard-coded list of known template types, extracted from sample_templates.xlsx.
// These are used in the TemplatePickerModal type filter and the TemplateBuilder
// type dropdown.
// To add a new type: append it to the relevant group array below.
// ──────────────────────────────────────────────────────────────────────────────

/** Standalone types (not part of an AUD or SI series) */
export const STANDALONE_TEMPLATE_TYPES: string[] = [
  'BA1',
  'BA2',
  'BA-C',
  'CAR',
  'CMR',
  'COA',
  'DOC',
  'DRR',
  'DT',
  'Dissemination',
  'INFO',
  'IR',
  'LN1',
  'LN2',
  'LN3',
  'NCR',
  'PSD',
  'QN',
  'QR',
  'RII',
];

/** AUD sub-types (audit series) */
export const AUD_TEMPLATE_TYPES: string[] = [
  'AUD-1.1',
  'AUD-1.2',
  'AUD-1.3a',
  'AUD-1.3b',
  'AUD-1.4',
  'AUD-1.5',
  'AUD-1.6',
  'AUD-2.1',
  'AUD-2.2',
  'AUD-2.3',
  'AUD-2.4',
  'AUD-2.5',
  'AUD-2.6',
  'AUD-3.1',
  'AUD-4.1',
  'AUD-4.2',
  'AUD-4.3',
  'AUD-4.4',
  'AUD-4.5',
  'AUD-4.6',
  'AUD-5.1',
  'AUD-6.1',
  'AUD-7.1',
  'AUD-7.2',
  'AUD-7.3',
  'AUD-7.4',
  'AUD-7.5',
  'AUD-8.1',
  'AUD-8.2',
  'AUD-9',
  'AUD-10',
  'AUD-11',
  'AUD-12',
  'AUD-13',
  'AUD-14',
  'AUD-15',
  'AUD-16',
  'AUD-17',
  'AUD-18',
  'AUD-19',
  'AUD-20',
  'AUD-21',
  'AUD-22',
];

/** SI sub-types (surveillance / inspection series) */
export const SI_TEMPLATE_TYPES: string[] = [
  'SI-1',
  'SI-2',
  'SI-3',
  'SI-4',
  'SI-5',
  'SI-6',
  'SI-7',
  'SI-8',
  'SI-9',
  'SI-10',
  'SI-11',
  'SI-12',
  'SI-13',
  'SI-14',
  'SI-15',
  'SI-16',
  'SI-17',
];

/** All template types combined (standalone → AUD → SI) */
export const ALL_TEMPLATE_TYPES: string[] = [
  ...STANDALONE_TEMPLATE_TYPES,
  ...AUD_TEMPLATE_TYPES,
  ...SI_TEMPLATE_TYPES,
];
