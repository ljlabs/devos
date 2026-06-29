# Documentation Standards

## Core Rule
**All documentation goes in `docs/` directory. Keep it minimal and practical.**

## What This Means

- Documentation should solve a specific problem
- No verbose explanations for the sake of thoroughness
- Update existing docs instead of creating new ones
- One-liners and bullet points preferred over paragraphs
- Examples > lengthy descriptions
- Link to code comments for implementation details

## Where Documentation Lives

### `docs/` Directory (Minimal, Focused)
- `ACP_ARCHITECTURE.md` - ACP protocol & message types
- `ARCHITECTURE_DIAGRAMS.md` - System diagrams
- `UI_RENDERING_GUIDE.md` - How messages render
- `QUICK_REFERENCE.md` - API & debugging
- `SQLITE_REFERENCE.md` - Database info (instead of verbose migration docs)

### Root Directory (Only Essential)
- `README.md` - Project overview
- `.env.example` - Config template

### No Root-Level Docs
❌ DO NOT create:
- Verbose migration guides at root
- Completion certificates
- Checklists that duplicate code
- Multiple "summary" docs
- Implementation guides outside `/docs`

## Standards

### Length
- Documentation file: < 200 lines target
- Section: < 30 lines typical
- Paragraph: < 5 lines

### Format
```markdown
# Topic

Brief description (1-2 lines).

## Subtopic
- Bullet point 1
- Bullet point 2

**Example**: code block or link to code
```

### Examples Over Prose
Instead of:
> "The cascade deletion feature works by leveraging SQLite's foreign key constraints to automatically delete related records when a parent record is deleted..."

Write:
```
DELETE workspace → deletes threads → deletes messages
(via ON DELETE CASCADE constraints)
```

## When Adding Features

1. **Code first**: Add comments in the code
2. **Reference second**: Link from `/docs`
3. **Document third**: Update existing doc, don't create new one
4. **If new doc needed**: Keep it under 200 lines

## Review Checklist

Before committing documentation:
- [ ] Is this in `docs/`? (Or essential root file)
- [ ] Could this be merged into existing docs?
- [ ] Is it under 200 lines?
- [ ] Does it have concrete examples?
- [ ] Could someone understand it in 2 minutes?

## Current State (Post-Migration)

Remove these excess root-level docs:
- `SQLITE_MIGRATION.md` → Merge into `docs/SQLITE_REFERENCE.md`
- `MIGRATION_SUMMARY.md` → Delete (info in code)
- `QUICK_START_SQLITE.md` → Delete (info in README)
- `TEST_COVERAGE.md` → Delete (info in code/test files)
- `MIGRATION_COMPLETE.md` → Delete (completed, not needed)
- `DELIVERABLES.md` → Delete (internal tracking)
- `IMPLEMENTATION_CHECKLIST.md` → Delete (completed)

Keep:
- `README.md` - Updated with SQLite reference
- `docs/SQLITE_REFERENCE.md` - New, minimal database guide
- All other `/docs` files unchanged

## SQLite Documentation Example

Bad (verbose):
```markdown
# SQLite Migration Guide - Complete Overview

DevOS has been upgraded from JSON to SQLite...
[3000 words of migration instructions]
```

Good (minimal):
```markdown
# SQLite Database

**Migration**: `npx tsx scripts/migrate-db.ts`

**Files**:
- `devos.db` - Database (auto-created)
- `db.sqlite.ts` - Layer implementation
- `scripts/migrate-db.ts` - Migration script

**Schema**: 4 tables (workspaces, threads, messages, allowedPatterns)
FK: threads→workspaces, messages→threads, ON DELETE CASCADE

**Tests**: 24 unit tests in `db.sqlite.test.ts`

See code comments for implementation details.
```

## Links, Not Copies

If documentation exists elsewhere:
- Link to it instead of duplicating
- Keep only summary + link in docs
- Example: Link to test file instead of listing all tests

## Questions Before Creating Docs

1. Does this already exist somewhere?
2. Can this be a comment in the code?
3. Can this be a quick link?
4. Is this truly essential vs nice-to-have?

If "no" to all 4: write minimal doc in `/docs`
If "yes" to any: don't create separate doc
