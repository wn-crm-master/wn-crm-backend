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

## Field Types

### Author Field Types
| Internal Field | Display Name | Type | Rules / Notes |
|---|---|---|---|
| `uid` | Author ID | Text | Unique key — any alphanumeric combination, no rules |
| `name` | Author Name | Text (single line) | Special Field |
| `regnDate` | Author Reg. Date | **Date** | Display as **DD/MM/YYYY** — Special Field |
| `locale` | Author Locale | Text (single line) | Country or city — no rules |
| `email` | Author Email ID | Email (single line) | Special Field |
| `phone` | Author Phone No. | Text (single line) | Special Field |
| `bucketTag` | Bucket Tag | Text → Dropdown (later) | Special Field |
| `contestTag` | Contest Tag | Text → Dropdown (later) | Special Field |
| `sourceTag` | Source Tag | Text (single line) | Special Field |
| `authorTypeTag` | Author Type Tag | Text (single line) | Special Field |
| `form1MailSent` | Form 1 Mail Sent | **Checkbox** (boolean) | |
| `form1FollowUp1Sent` | Form 1 Follow Up 1 Sent | **Checkbox** (boolean) | |
| `form1FollowUp2Sent` | Form 1 Follow Up 2 Sent | **Checkbox** (boolean) | |
| `form1Filled` | Form 1 Filled | **Checkbox** (boolean) | |
| `preContractedTag` | Pre-Contract Validation | **Dropdown** | Special Field — values TBD |
| `preContractCompany` | Pre-Contract Company | Text (single line) | Special Field |
| `incentiveFlag` | Author Incentive Flag | **Dropdown** | Values: `0` / `1` / *(blank)* |
| `booksCreated` | Books Created | **Rollup** (read-only) | Count of all books linked to this author |
| `booksChp1Published` | Books Chp1 Published | **Rollup** (read-only) | Count of linked books where `chp1Published` = true |
| `books10kCompleted` | Books 10k Completed | **Rollup** (read-only) | Count of linked books where `words10kCompleted` = true |
| `booksModPassed` | Books Mod Passed | **Rollup** (read-only) | Count of linked books where `moderationStatus` contains "pass" |
| `booksExpressContracted` | Books Express Contracted | **Rollup** (read-only) | Count of linked books where `wbpStatus` contains "express" |
| `booksWBPContracted` | Books WBP Contracted | **Rollup** (read-only) | Count of linked books where `wbpStatus` contains "wbp" |
| `booksOFW` | Books OFW | **Rollup** (read-only) | Count of linked books where `wbpSubStatus` contains "open for withdrawal" / "ofw" |

> Rollup fields are computed live from the books collection — never stored on author records, never imported from CSV.

---

## CSV Column Mapping

### Authors CSV (Author Level Data)
| CSV Column | Internal Field | Notes |
|---|---|---|
| Author ID | `uid` | **Unique ID** |
| Author Name | `name` | Special Field |
| Author Reg. Date | `regnDate` | Special Field — date, display DD/MM/YYYY |
| Author Locale | `locale` | Special Field |
| Author Email ID | `email` | Special Field |
| Author Phone No. | `phone` | Special Field |
| Bucket Tag | `bucketTag` | Special Field |
| Contest Tag | `contestTag` | Special Field |
| Source Tag | `sourceTag` | Special Field |
| Author Type Tag | `authorTypeTag` | Special Field |
| Form 1 Mail Sent | `form1MailSent` | Checkbox |
| Form 1 Follow Up 1 Sent | `form1FollowUp1Sent` | Checkbox |
| Form 1 Follow Up 2 Sent | `form1FollowUp2Sent` | Checkbox |
| Form 1 Filled | `form1Filled` | Checkbox |
| Pre-Contract Validation | `preContractedTag` | Special Field — dropdown |
| Pre-Contract Company | `preContractCompany` | Special Field |
| No. of Books Created | `booksCreated` | **Ignored on import** — rollup |
| No. of Books Chp1 Published | `booksChp1Published` | **Ignored on import** — rollup |
| No. of Books 10k Words Completed | `books10kCompleted` | **Ignored on import** — rollup |
| No. of Books Mod Passed | `booksModPassed` | **Ignored on import** — rollup |
| No. of Books Express Contracted | `booksExpressContracted` | **Ignored on import** — rollup |
| No. of Books WBP Contracted | `booksWBPContracted` | **Ignored on import** — rollup |
| No. of Books OFW | `booksOFW` | **Ignored on import** — rollup |

### Book Field Types
| Internal Field | Display Name | Type | Rules / Notes |
|---|---|---|---|
| `id` | Book ID | Text | Unique key — alphanumeric, no rules |
| `authorId` | Author ID | Text | Foreign key → Author `uid` — Special Field |
| `title` | Book Title | Text (single line) | Special Field |
| `showId` | Show ID | Text (single line) | Special Field |
| `showTitle` | Show Title | Text (single line) | Special Field |
| `showStatus` | Show Status | **Dropdown** | Values: `Disabled` / `Published` / `Unpublished` / *(blank)* |
| `createDate` | Book Create Date | **Date** | DD/MM/YYYY — Special Field |
| `status` | Book Status | **Dropdown** | Values: `Disabled` / `Published` / `Unpublished` / *(blank)* — Special Field |
| `pubWC` | Pub WC | **Number** | Comma-formatted (e.g. 12,500) |
| `chp1Published` | Chp 1 Published | **Checkbox** (boolean) | |
| `chp1PublishedDate` | Chp 1 Published Date | **Date** | DD/MM/YYYY |
| `words10kCompleted` | 10k Words Completed | **Checkbox** (boolean) | |
| `words10kDate` | 10k Words Date | **Date** | DD/MM/YYYY |
| `moderationStatus` | Moderation Status | **Dropdown** | Values: `Passed` / `Failed` / *(blank)* |
| `moderationPassedDate` | Mod Passed Date | **Date** | DD/MM/YYYY |
| `editorScore` | Book Editor Score | **Number** | 0, 1, or 10 — plain number |
| `words50kCompleted` | 50k Words Completed | **Checkbox** (boolean) | |
| `words50kDate` | 50k Words Date | **Date** | DD/MM/YYYY |
| `llmScore5hr` | 5hr LLM Score | **Decimal** | Decimal number |
| `wbpStatus` | WBP Status | **Dropdown** | Values: `Pending` / `Ongoing` / `Rejected` / `Completion` / *(blank)* |
| `wbpSubStatus` | WBP Sub Status | **Dropdown** | Values: `Open for Withdrawal` / `Payment Info Pending` / `Signing Pending` / *(blank)* |
| `incentiveFlag` | Book Incentive Flag | **Dropdown** | Values: `0` / `1` / *(blank)* |
| `wbpContractingDate` | WBP Contracting Date | **Date** | DD/MM/YYYY |
| `ppvTag` | PPV Tag | **Dropdown** | Values: `Average` / `Bad` / `PPV` / `Testing P1` / `Testing P2` / `Testing P3` / `Untested` / `Action Needed` / `P3 Failed` / *(blank)* |
| `ppvTagDate` | PPV Tag Date | **Date** | DD/MM/YYYY |
| `ldaus` | LDAUs | **Number** | |
| `h1EligibleLdau` | H1 Eligible LDAU | **Number** | |
| `h1Ret` | H1 Ret% | **Percentage** | |
| `h5EligibleLdau` | H5 Eligible LDAU | **Number** | |
| `h5Ret` | H5 Ret% | **Percentage** | |
| `h10EligibleLdau` | H10 Eligible LDAU | **Number** | |
| `h10Ret` | H10 Ret% | **Percentage** | |
| `h15EligibleLdau` | H15 Eligible LDAU | **Number** | |
| `h15Ret` | H15 Ret% | **Percentage** | |

---

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
