#!/usr/bin/env tsx

/**
 * migrate-db.ts
 *
 * Migrates data from db.json to SQLite database.
 * 
 * Usage:
 *   npx tsx scripts/migrate-db.ts [--from path/to/db.json] [--to path/to/devos.db]
 */

import fs from "fs";
import path from "path";
import { SqliteDb } from "../server_src/db.sqlite";

async function migrate() {
  const args = process.argv.slice(2);
  
  let fromPath = path.join(process.cwd(), "db.json");
  let toPath = path.join(process.cwd(), "devos.db");

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      fromPath = args[i + 1];
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      toPath = args[i + 1];
      i++;
    }
  }

  console.log(`📂 Migrating from: ${fromPath}`);
  console.log(`📂 Migrating to:   ${toPath}`);

  // Check if source file exists
  if (!fs.existsSync(fromPath)) {
    console.error(`❌ Source file not found: ${fromPath}`);
    process.exit(1);
  }

  // Check if destination already exists
  if (fs.existsSync(toPath)) {
    console.warn(`⚠️  Destination file already exists: ${toPath}`);
    console.warn(`    Please back up or delete it before migrating.`);
    process.exit(1);
  }

  try {
    // Read the JSON file
    console.log(`📖 Reading JSON database...`);
    const jsonData = JSON.parse(fs.readFileSync(fromPath, "utf-8"));

    // Create SQLite database and migrate data
    console.log(`💾 Creating SQLite database...`);
    const sqliteDb = new SqliteDb(toPath);

    console.log(`📝 Migrating data...`);
    const migrationData = {
      workspaces: jsonData.workspaces || [],
      threads: jsonData.threads || [],
      messages: jsonData.messages || [],
      allowedPatterns: jsonData.allowedPatterns || [],
    };

    sqliteDb.writeDb(migrationData);

    // Verify the migration
    const readBack = sqliteDb.readDb();
    console.log(`✅ Migration successful!`);
    console.log(`   - Workspaces: ${readBack.workspaces.length}`);
    console.log(`   - Threads: ${readBack.threads.length}`);
    console.log(`   - Messages: ${readBack.messages.length}`);
    console.log(`   - Allowed Patterns: ${readBack.allowedPatterns.length}`);

    // Backup the old file
    const backupPath = fromPath + ".backup";
    fs.copyFileSync(fromPath, backupPath);
    console.log(`💾 Old file backed up to: ${backupPath}`);

    sqliteDb.close();
    console.log(`\n🎉 Migration complete! You can now delete ${fromPath} if everything looks good.`);
  } catch (err: any) {
    console.error(`❌ Migration failed: ${err.message}`);
    process.exit(1);
  }
}

migrate().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
