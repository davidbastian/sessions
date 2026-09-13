import fs from 'fs';
import path from 'path';

/*
 * The instructions, as files rather than template literals.
 *
 * What the model is told is the product here — every mode in this app is a
 * paragraph written for a model, and the difference between a useful result and
 * a shrug is a sentence in that paragraph. Buried in route.ts they were
 * TypeScript: to change one you edited code, and to read one you scrolled past
 * a string escape.
 *
 * So each generation type is a folder under skills/ with a SKILL.md in it:
 * frontmatter saying what it takes and returns, then one section per thing the
 * app might need to say. They are read once, at module load, straight off disk —
 * this only ever runs on the server, so there is no bundler trick and no
 * runtime fetch.
 *
 * Placeholders are {{name}} and are filled by the caller. Anything the caller
 * does not supply becomes an empty string rather than the literal braces: a
 * missing optional line should disappear, not appear as syntax.
 */

export interface Skill {
  name: string;
  description: string;
  /** Every "## Heading" in the file, by its heading, lowercased. */
  sections: Record<string, string>;
}

const DIR = path.join(process.cwd(), 'skills');

function parse(md: string): Skill {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  const head = fm ? fm[1] : '';
  const body = fm ? md.slice(fm[0].length) : md;

  const field = (k: string) => {
    const m = head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };

  const sections: Record<string, string> = {};
  for (const part of body.split(/^## +/m).slice(1)) {
    const nl = part.indexOf('\n');
    sections[part.slice(0, nl).trim().toLowerCase()] = part.slice(nl + 1).trim();
  }

  return { name: field('name'), description: field('description'), sections };
}

function load(): Record<string, Skill> {
  const out: Record<string, Skill> = {};
  let names: string[] = [];
  try {
    names = fs.readdirSync(DIR);
  } catch {
    return out;                       // no skills folder: say() returns '' and the app still runs
  }
  for (const name of names) {
    const file = path.join(DIR, name, 'SKILL.md');
    try {
      out[name] = parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      /* a folder without a SKILL.md is not a skill */
    }
  }
  return out;
}

export const SKILLS = load();

/**
 * One section of one skill, with its placeholders filled.
 *
 * A missing skill, a missing section or a missing value all resolve to an empty
 * string: an instruction should never reach a model with "{{label}}" in it.
 */
export function say(skill: string, section: string, vars: Record<string, string | number | undefined> = {}) {
  const text = SKILLS[skill]?.sections[section.toLowerCase()] ?? '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}
