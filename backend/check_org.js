const XLSX = require('xlsx');
const wb = XLSX.readFile('sample_templates.xlsx');
const sheet = wb.Sheets['Templates'];
const rows = XLSX.utils.sheet_to_json(sheet);
const orgRows = rows.filter(r => JSON.stringify(r).includes('ORG'));
console.log('Total rows:', rows.length);
console.log('ORG rows:', orgRows.length);
if(orgRows.length > 0) {
  console.log('Sample ORG row:', orgRows[0]);
}
