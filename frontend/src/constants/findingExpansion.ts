import { RcaMethod, FindingLinkType } from '../types';

export const RCA_METHOD_OPTIONS: { value: RcaMethod; label: string }[] = [
  { value: 'FIVE_WHYS', label: '5-Whys' },
  { value: 'MEDA', label: 'MEDA (Maintenance Error Decision Aid)' },
  { value: 'OTHER', label: 'Other / Narrative' },
];

// MEDA contributing-factor categories — must match backend RCA_MEDA_CATEGORIES.
export const RCA_MEDA_CATEGORIES = [
  'Information',
  'Ground Support Equipment/Tools/Safety Equipment',
  'Aircraft Design/Configuration/Parts',
  'Job/Task',
  'Knowledge/Skills',
  'Individual Factors',
  'Environment/Facilities',
  'Organizational Factors',
  'Leadership/Supervision',
  'Communication',
];

export const LINK_TYPE_OPTIONS: { value: FindingLinkType; label: string }[] = [
  { value: 'RELATED', label: 'Related to' },
  { value: 'DUPLICATE', label: 'Duplicate of' },
  { value: 'CAUSED_BY', label: 'Caused by' },
];
