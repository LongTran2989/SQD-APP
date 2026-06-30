import * as XLSX from 'xlsx';

const csv = `Start Date,Start Time\n11/09/2026,13:00\n23/07/2026,9:00`;

const wb1 = XLSX.read(csv, { type: 'string' });
console.log('Without raw:', XLSX.utils.sheet_to_json(wb1.Sheets[wb1.SheetNames[0] as string]!));

const wb2 = XLSX.read(csv, { type: 'string', raw: true });
console.log('With raw: true:', XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0] as string]!));
