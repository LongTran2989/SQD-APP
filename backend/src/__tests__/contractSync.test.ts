import * as fs from 'fs';
import * as path from 'path';
import {
  TASK_STATUSES,
  FINAL_TASK_STATUSES,
  REVIEW_ACTIONS,
  DEADLINE_DECISIONS,
} from '../constants/taskStatus';

// Guard: the frontend mirror must not drift from this backend authority. The two
// projects have isolated tsconfigs and cannot import each other, so we parse the
// frontend file as text and assert every contract array matches. If this fails,
// update frontend/src/constants/taskStatus.ts to match the backend.
const FRONTEND_MIRROR = path.resolve(
  __dirname,
  '../../../frontend/src/constants/taskStatus.ts'
);

function extractArray(source: string, name: string): string[] {
  // Grab `export const NAME ...= [ ... ]` and collect the single-quoted tokens.
  const re = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`);
  const body = source.match(re)?.[1];
  if (!body) throw new Error(`Could not find "export const ${name}" in the frontend mirror`);
  return Array.from(body.matchAll(/'([^']+)'/g), (x) => x[1] as string);
}

const mirrorExists = fs.existsSync(FRONTEND_MIRROR);
// Skip (don't fail) in a backend-only checkout where the frontend isn't present.
const describeOrSkip = mirrorExists ? describe : describe.skip;

describeOrSkip('task contract literals stay in sync with the frontend mirror', () => {
  const source = mirrorExists ? fs.readFileSync(FRONTEND_MIRROR, 'utf8') : '';

  it.each([
    ['TASK_STATUSES', [...TASK_STATUSES]],
    ['FINAL_TASK_STATUSES', [...FINAL_TASK_STATUSES]],
    ['REVIEW_ACTIONS', [...REVIEW_ACTIONS]],
    ['DEADLINE_DECISIONS', [...DEADLINE_DECISIONS]],
  ])('%s matches the backend authority', (name, backendValues) => {
    expect(extractArray(source, name as string)).toEqual(backendValues);
  });
});
