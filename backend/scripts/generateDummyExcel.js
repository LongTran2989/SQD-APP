const xlsx = require('xlsx');

const workbook = xlsx.utils.book_new();

// Sheet 1: Templates
const templates = [
  {
    TemplateRef: 'T1',
    Title: 'Excel Import Test Audit',
    Description: 'An audit template imported from excel',
    Type: 'AUDIT',
    RequiresApproval: false,
    AllowsFindings: true,
    SkillLevel: 1,
    EstimatedHours: 2.5
  }
];
const templateSheet = xlsx.utils.json_to_sheet(templates);
xlsx.utils.book_append_sheet(workbook, templateSheet, 'Templates');

// Sheet 2: FormFields
const formFields = [
  {
    TemplateRef: 'T1',
    FieldId: 'q1',
    Type: 'text',
    Label: 'Auditor Name',
    Required: true,
    HelpText: 'Provide full name'
  },
  {
    TemplateRef: 'T1',
    FieldId: 'q2',
    Type: 'select',
    Label: 'Target Dept',
    Required: true,
    DataSource: 'departments'
  },
  {
    TemplateRef: 'T1',
    FieldId: 'q3',
    Type: 'radio',
    Label: 'Pass/Fail',
    Required: true,
    Options: 'Pass, Fail, N/A'
  }
];
const fieldsSheet = xlsx.utils.json_to_sheet(formFields);
xlsx.utils.book_append_sheet(workbook, fieldsSheet, 'FormFields');

xlsx.writeFile(workbook, 'sample_templates.xlsx');
console.log('Created sample_templates.xlsx');
