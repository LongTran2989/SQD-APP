import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as fs from 'fs';

const prisma = new PrismaClient();

// Usage: npx ts-node scripts/importTemplates.ts --file ./templates.xlsx --division QA --owner VAE00071

async function main() {
  const args = process.argv.slice(2);
  let filePath = '';
  let divisionCode = '';
  let ownerEmployeeId = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) filePath = args[i + 1] || '';
    if (args[i] === '--division' && args[i + 1]) divisionCode = args[i + 1] || '';
    if (args[i] === '--owner' && args[i + 1]) ownerEmployeeId = args[i + 1] || '';
  }

  if (!filePath || !divisionCode || !ownerEmployeeId) {
    console.error('Usage: npx ts-node scripts/importTemplates.ts --file <path> --division <Code> --owner <EmployeeId>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  // 1. Look up Division
  const division = await prisma.division.findUnique({
    where: { code: divisionCode },
  });

  if (!division) {
    console.error(`Division not found with code: ${divisionCode}`);
    process.exit(1);
  }

  // 2. Look up Owner
  const owner = await prisma.user.findUnique({
    where: { employeeId: ownerEmployeeId },
  });

  if (!owner) {
    console.error(`User not found with employeeId: ${ownerEmployeeId}`);
    process.exit(1);
  }

  console.log(`Importing templates for Division: ${division.name} (${division.code}), Owner: ${owner.name}`);

  // 3. Read Excel
  const workbook = xlsx.readFile(filePath);
  const templateSheet = workbook.Sheets['Templates'];
  const fieldsSheet = workbook.Sheets['FormFields'];

  if (!templateSheet || !fieldsSheet) {
    console.error('Excel file must contain both "Templates" and "FormFields" sheets.');
    process.exit(1);
  }

  const templatesRaw = xlsx.utils.sheet_to_json(templateSheet);
  const fieldsRaw = xlsx.utils.sheet_to_json(fieldsSheet);

  console.log(`Found ${templatesRaw.length} templates and ${fieldsRaw.length} form fields.`);

  // Group fields by TemplateRef
  const fieldsByRef: Record<string, any[]> = {};
  for (const row of fieldsRaw as any[]) {
    const ref = row.TemplateRef;
    if (!ref) continue;
    if (!fieldsByRef[ref]) fieldsByRef[ref] = [];
    
    const isRequired = row.Required === true || row.Required === 'TRUE' || row.Required === 'true';

    let optionsArray: string[] | undefined = undefined;
    if (row.Options) {
      optionsArray = String(row.Options).split(',').map(s => s.trim()).filter(s => s);
    }

    const field: any = {
      id: String(row.FieldId || Math.random().toString(36).substring(7)),
      type: row.Type || 'text',
      label: row.Label || 'Unnamed Field',
      required: isRequired,
    };

    if (row.HelpText) field.helpText = row.HelpText;
    if (optionsArray && optionsArray.length > 0) field.options = optionsArray;
    if (row.DataSource) field.dataSource = row.DataSource;

    fieldsByRef[ref].push(field);
  }

  // Find max existing sequence for templateId
  const existingTemplates = await prisma.template.findMany({
    where: { templateId: { startsWith: `${division.code}-` } },
    select: { templateId: true },
  });

  let maxSeq = 0;
  for (const t of existingTemplates) {
    const parts = t.templateId.split('-');
    if (parts.length >= 2) {
      const seq = parseInt(parts[parts.length - 1] || '', 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  // 4. Insert Templates
  let count = 0;
  for (const tRow of templatesRaw as any[]) {
    const ref = tRow.TemplateRef;
    if (!ref) continue;

    // Use draftSchema to allow users to review in the UI
    const formSchema: any[] = []; // Draft templates have empty active schema
    const draftSchema = {
      title: tRow.Title || 'Untitled Template',
      description: tRow.Description || null,
      formSchema: fieldsByRef[ref] || [],
      requiresApproval: tRow.RequiresApproval === true || tRow.RequiresApproval === 'TRUE' || tRow.RequiresApproval === 'true',
      allowsFindings: tRow.AllowsFindings === true || tRow.AllowsFindings === 'TRUE' || tRow.AllowsFindings === 'true' || tRow.AllowsFindings === undefined,
      skillLevel: parseInt(tRow.SkillLevel) || 0,
      estimatedHours: parseFloat(tRow.EstimatedHours) || null,
      type: tRow.Type || null,
    };
    
    maxSeq++;
    const nextSeqStr = maxSeq.toString().padStart(3, '0');
    const newTemplateId = `${division.code}-${nextSeqStr}`;

    const templateData = {
      templateId: newTemplateId,
      title: draftSchema.title,
      description: draftSchema.description,
      status: 'Draft',
      requiresApproval: draftSchema.requiresApproval,
      allowsFindings: draftSchema.allowsFindings,
      skillLevel: draftSchema.skillLevel,
      estimatedHours: draftSchema.estimatedHours,
      type: draftSchema.type,
      divisionId: division.id,
      ownerId: owner.id,
      formSchema: formSchema,
      draftSchema: draftSchema,
    };

    await prisma.template.create({
      data: templateData
    });

    console.log(`Created template ${newTemplateId}: ${templateData.title} with ${draftSchema.formSchema.length} draft fields.`);
    count++;
  }

  console.log(`\nSuccessfully imported ${count} templates.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
