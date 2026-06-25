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

**Books — Special Fields (confirmed):**

| Field (Internal) | Display Name |
|---|---|
| `authorId` | Author ID |
| `title` | Book Title |
| `showId` | Show ID |
| `showTitle` | Show Title |
| `createDate` | Book Create Date |
| `status` | Book Status |

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

## Author → Book Relationship

- Every Book must have an `Author ID` (`authorId`) that maps to an Author record.
- One Author can have many Books; one Book has exactly one Author.
- **If a book import contains an `Author ID` not found in the authors collection, the system will automatically create a stub author entry** with just the `uid` field set. This stub can be filled in later via an author import.

---

## CSV Column Mapping

### Authors CSV (Author Level Data)
| CSV Column | Internal Field | Notes |
|---|---|---|
| Author ID | `uid` | **Unique ID** |
| Author Name | `name` | Special Field |
| Author Reg. Date | `regnDate` | Special Field |
| Author Locale | `locale` | Special Field |
| Author Email ID | `email` | Special Field |
| Author Phone No. | `phone` | Special Field |
| Bucket Tag | `bucketTag` | Special Field |
| Contest Tag | `contestTag` | Special Field |
| Source Tag | `sourceTag` | Special Field |
| Author Type Tag | `authorTypeTag` | Special Field |
| Form 1 Mail Sent | `form1MailSent` | |
| Form 1 Follow Up 1 Sent | `form1FollowUp1Sent` | |
| Form 1 Follow Up 2 Sent | `form1FollowUp2Sent` | |
| Form 1 Filled | `form1Filled` | |
| Pre-Contract Validation | `preContractedTag` | Special Field |
| Pre-Contract Company | `preContractCompany` | Special Field |
| No. of Books Created | `booksCreated` | |
| No. of Books Chp1 Published | `booksChp1Published` | |
| No. of Books 10k Words Completed | `books10kCompleted` | |
| No. of Books Mod Passed | `booksModPassed` | |
| No. of Books Express Contracted | `booksExpressContracted` | |
| No. of Books WBP Contracted | `booksWBPContracted` | |
| No. of Books OFW | `booksOFW` | |

### Books CSV (Book Level Data)
| CSV Column | Internal Field | Notes |
|---|---|---|
| Book ID | `id` | **Unique ID** |
| Author ID | `authorId` | Foreign key → Author `uid` — Special Field |
| Book Title | `title` | Special Field |
| Show ID | `showId` | Special Field |
| Show Title | `showTitle` | Special Field |
| Book Create Date | `createDate` | Special Field |
| Book Status | `status` | Special Field |
| Pub WC | `pubWC` | |
| Chp 1 Published | `chp1Published` | |
| Chp 1 Published Date | `chp1PublishedDate` | |
| 10k Words Completed? | `words10kCompleted` | |
| 10k words completion Date | `words10kDate` | |
| Moderation Status | `moderationStatus` | |
| Moderation Passed Date | `moderationPassedDate` | |
| Book Editor Score | `editorScore` | |
| 50k Words Completed? | `words50kCompleted` | |
| 50k words completed date? | `words50kDate` | |
| 5 hr LLM Score | `llmScore5hr` | |
| WBP Status | `wbpStatus` | |
| WBP Sub Status | `wbpSubStatus` | |
| Incentive Flag | `incentiveFlag` | |
| WBP Contracting Date? | `wbpContractingDate` | |
| PPV Tag | `ppvTag` | |
| PPV Tag Date | `ppvTagDate` | |
| LDAUs | `ldaus` | |
| H1 Eligible LDAU | `h1EligibleLdau` | |
| H1 Ret% | `h1Ret` | |
| H5 Eligible LDAU | `h5EligibleLdau` | |
| H5 Ret% | `h5Ret` | |
| H10 Eligible LDAU | `h10EligibleLdau` | |
| H10 Ret% | `h10Ret` | |
| H15 Eligible LDAU | `h15EligibleLdau` | |
| H15 Ret% | `h15Ret` | |

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
