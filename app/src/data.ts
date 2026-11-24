import type { SenKey } from './i18n';
import jobsData from './jobs.json';

export interface Job {
  id: number; title: string; company: string; ini: string; role: string; sen: SenKey;
  c: string[]; h: number; pay: string | null; ct: 'contractor' | 'fulltime';
  stack: string[]; url: string; about: string; reqs: string[];
}

export const ROLES: [string, string][] = [['frontend', 'Frontend'], ['backend', 'Backend'], ['fullstack', 'Full-stack'], ['mobile', 'Mobile'], ['devops', 'DevOps / SRE'], ['data', 'Data'], ['qa', 'QA']];
export const SEN: SenKey[] = ['junior', 'mid', 'senior', 'lead'];
export const COUNTRIES: [string, string][] = [['AR', 'Argentina'], ['BR', 'Brasil'], ['CL', 'Chile'], ['CO', 'Colombia'], ['CR', 'Costa Rica'], ['MX', 'México'], ['PE', 'Perú'], ['UY', 'Uruguay']];

/**
 * Real openings, written by `node scripts/fetch-jobs.mjs` (see scripts/companies.json).
 * h = hours since the posting was published, as of the scraper run.
 */
export const JOBS: Job[] = jobsData as Job[];
