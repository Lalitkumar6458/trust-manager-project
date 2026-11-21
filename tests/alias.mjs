// lets the tests import app files that use the "@/…" path alias (jsconfig.json)
import { register } from 'node:module';
register('./alias-hooks.mjs', import.meta.url);
