import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/schema.ts', './src/db/schema2.ts', './src/db/schema3.ts', './src/db/schema4.ts', './src/db/schema5.ts', './src/db/schema6.ts', './src/db/schema7.ts', './src/db/schema8.ts', './src/db/schema9.ts', './src/db/schema10.ts', './src/db/schema11.ts', './src/db/schema12.ts', './src/db/schema13.ts'],
  out: './drizzle',
});
