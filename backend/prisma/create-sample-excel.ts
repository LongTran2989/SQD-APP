// Helper script to generate a sample templates.xlsx with example rows.
// Run: npx ts-node prisma/create-sample-excel.ts
// Output: backend/prisma/data/templates-sample.xlsx
import * as XLSX from 'xlsx';
import * as path from 'path';

const templateRows = [
  {
    'ID':               'QA-001',
    'Title':            'Line Maintenance Check',
    'Description':      'Daily line maintenance inspection checklist',
    'Division':         'QA',
    'Requires Approval':'no',
    'Allows Findings':  'yes',
    'Estimated Hours':  2,
    'Skill Level':      1,
    'Type':             'CHECK',
    'Status':           'Published',
  },
  {
    'ID':               'QCH-001',
    'Title':            'Hanoi Base Audit',
    'Description':      'Annual base audit for Hanoi facility',
    'Division':         'QCH',
    'Requires Approval':'yes',
    'Allows Findings':  'yes',
    'Estimated Hours':  8,
    'Skill Level':      2,
    'Type':             'AUDIT',
    'Status':           'Draft',
  },
];

const fieldRows = [
  { 'Template ID': 'QA-001', 'Label': 'Aircraft Registration', 'Type': 'text',   'Required': 'yes', 'Help Text': 'e.g. VN-A123', 'Options': '' },
  { 'Template ID': 'QA-001', 'Label': 'Check Type',            'Type': 'select', 'Required': 'yes', 'Help Text': '',              'Options': 'Pre-flight,Post-flight,Transit' },
  { 'Template ID': 'QA-001', 'Label': 'Observation',           'Type': 'textarea','Required': 'no', 'Help Text': 'Any observations or remarks', 'Options': '' },
  { 'Template ID': 'QCH-001','Label': 'Audit Date',            'Type': 'date',   'Required': 'yes', 'Help Text': '',              'Options': '' },
  { 'Template ID': 'QCH-001','Label': 'Area Audited',          'Type': 'select', 'Required': 'yes', 'Help Text': '',              'Options': 'Hangar,Workshop,Stores,Office' },
  { 'Template ID': 'QCH-001','Label': 'Compliance Status',     'Type': 'radio',  'Required': 'yes', 'Help Text': '',              'Options': 'Compliant,Non-Compliant,Partially Compliant' },
  { 'Template ID': 'QCH-001','Label': 'Findings Summary',      'Type': 'rich_text','Required': 'no','Help Text': 'Describe findings in detail', 'Options': '' },
];

const wb = XLSX.utils.book_new();

const wsTemplates = XLSX.utils.json_to_sheet(templateRows);
XLSX.utils.book_append_sheet(wb, wsTemplates, 'Templates');

const wsFields = XLSX.utils.json_to_sheet(fieldRows);
XLSX.utils.book_append_sheet(wb, wsFields, 'Fields');

const outPath = path.resolve(__dirname, 'data', 'templates-sample.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`✅ Sample Excel written to: ${outPath}`);
