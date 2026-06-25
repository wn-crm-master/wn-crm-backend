# Import Logic — Specification

> This file is part of the project memory. All import behavior must follow these rules.

---

## Overview

The system supports two independent import modules:
- **Authors Import** — uses `Author UID` as the unique identifier
- **Books Import** — uses `Book ID` as the unique identifier

These two modules are completely separate. Author data and Book data must never be mixed or confused during import.

---

## Unique Identifiers

| Entity | Unique ID Field | Notes |
|---|---|---|
| Author | `uid` / `Author UID` | Most critical field. Every author record must have one. |
| Book | `id` / `Book ID` | Most critical field. Every book record must have one. |

If a record does not have a unique ID, it must be **rejected** and flagged in the import result. It should never be inserted without an ID.

---

## Insert vs Update Logic

For every record in an import:

1. **Look up** the record in the database by its unique ID.
2. **If not found** → Insert as a new entry.
3. **If found** → Apply update logic (see below).

---

## Update Logic

When a matching record is found by ID, the following rules apply before any field is overwritten:

### Rule 1 — No Blank Overwrite
If the incoming value for a field is blank (`""`, `null`, `undefined`, or whitespace-only), **do not overwrite** the existing value for that field. Existing data is preserved.

### Rule 2 — No Error Value Overwrite
If the incoming value looks like an error (e.g. `"N/A"`, `"#ERROR"`, `"undefined"`, `"null"` as a string), **do not overwrite** the existing value.

### Rule 3 — Special Fields Require Approval ⚠️ PENDING
Certain fields are designated as **Special Fields**. If an import attempts to change the value of a Special Field on an existing record:
- The system must **pause** and surface the change to the user.
- The user must explicitly **approve or reject** the change before it is applied.
- If rejected, the old value is preserved.
- All other (non-special) fields in the same record proceed normally without needing approval.

**Authors — Special Fields (confirmed):**

| Field (Internal) | Display Name |
|---|---|
| `name` | Author Name |
| `regnDate` | Author Reg. Date |
| `locale` | Author Locale |
| `email` | Author Email ID |
| `phone` | Author Phone No. |
| `bucketTag` | Bucket Tag |
| `contestTag` | Contest Tag |
| `sourceTag` | Source Tag |
| `authorTypeTag` | Author Type Tag |
| `preContractedTag` | Pre-Contract Validation |
| `preContractCompany` | Pre-Contract Company |

**Books — Special Fields:** Not yet defined. Pending input from product owner.

### Rule 4 — Normal Fields
All fields not in the Special Fields list are overwritten freely with the incoming value, subject to Rules 1 and 2.

---

## Backup & Rollback

### Before any update:
Before overwriting an existing record, the system saves a **snapshot** of the current record into a backup collection (`authors_backups` / `books_backups`) with:
- The original record data
- A `backedUpAt` timestamp
- The `importId` of the import that triggered the change

### Retention:
Backups are retained for **24 hours** from the time of import. After 24 hours they may be deleted.

### Rollback (via Settings):
- The Settings section lists all available backups with their timestamp and record count.
- The user can select a backup and restore it, which overwrites the current record with the backed-up version.
- Rollback is available only within the 24-hour window.

---

## Import Result Response

Every import returns a summary:

```json
{
  "success": true,
  "importId": "abc123",
  "inserted": 12,
  "updated": 8,
  "skipped": 2,
  "skippedReasons": [
    { "id": null, "reason": "Missing unique ID" },
    { "id": "a99", "reason": "All incoming fields were blank" }
  ],
  "specialFieldChanges": [
    {
      "id": "a05",
      "field": "contractStatus",
      "oldValue": "Active",
      "newValue": "Churned",
      "status": "pending_approval"
    }
  ]
}
```

---

## CSV Column Mapping

### Authors CSV
| CSV Column | Internal Field |
|---|---|
| Author Name | `name` |
| Email ID | `email` |
| Author UID | `uid` (unique ID) |
| Regn. Date | `regnDate` |
| Prev Platform Tag | `prevPlatformTag` |
| Pre-Contracted Tag | `preContractedTag` |

### Books CSV
| CSV Column | Internal Field |
|---|---|
| Book ID | `id` (unique ID) |
| Title | `title` |
| Author UID | `authorId` |
| Author Name | `authorName` |
| Genre | `genre` |
| Published Year | `publishedYear` |
| Rating | `rating` |
| Pages | `pages` |
| Language | `language` |
| Description | `description` |

> These mappings can be extended as new fields are added to either module.

---

## Error Values (Reject List)
The following incoming values must never overwrite existing data:
- `""` (empty string)
- `null`
- `undefined`
- `"null"` (string)
- `"undefined"` (string)
- `"N/A"`
- `"#ERROR"`
- `"#REF!"`
- Whitespace-only strings

---

*Last updated: June 2026*
*Status: Special Fields list PENDING — must be defined before full implementation*
