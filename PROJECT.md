# Authors CRM — Project Document

> Platform for managing webnovel authors, their books, contracts, and workflows.

---

## Current Status (MVP Live)
- [x] Auth (login / register)
- [x] Import authors via CSV or JSON
- [x] Authors dashboard table (Name, Email, UID, Regn. Date, Platform Tag, Pre-Contracted Tag)
- [x] Delete all authors
- [ ] Everything below is planned

---

## Module Buckets

### 1. General
Settings and user management for the CRM itself.

| Feature | Description | Status |
|---|---|---|
| Personal Settings | Profile, password, preferences | Planned |
| Users & Roles | Add CRM team members, assign roles (Admin, Editor, Viewer) | Planned |
| Company Settings | Org name, logo, timezone | Planned |

---

### 2. Authors
Core module — the primary entity in this CRM.

| Feature | Description | Status |
|---|---|---|
| Author List | Table view with search & filter | Done (basic) |
| Author Profile | Full detail page per author | Planned |
| Import (CSV / JSON) | Bulk import author data — separate endpoint, ID-keyed upsert, no-blank-overwrite, 24hr backup | Done |
| Delete Data | Wipe all author records | Done |
| Tags & Segments | Prev Platform Tag, Pre-Contracted, Active, Churned, etc. | Partial (import only) |
| **Special Fields** | **Fields that require user approval before overwrite — list TBD** | **⚠️ PENDING DEFINITION** |
| Notes & Activity | Log calls, meetings, emails per author | Planned |
| Status Tracking | Track author lifecycle (Lead → Contracted → Active → Churned) | Planned |

---

### 3. Books
Tracks books/stories linked to authors.

| Feature | Description | Status |
|---|---|---|
| Books List | Table with title, author, genre, year, rating | Done (basic) |
| Book Detail Page | Full metadata view | Planned |
| Link to Author | Books linked to author profiles | Planned |
| Import Books | CSV/JSON import for book data | Partial (JSON only) |
| Performance Metrics | Views, reads, revenue per book | Planned |

---

### 4. Contracts & Agreements
Track contractual relationships with authors.

| Feature | Description | Status |
|---|---|---|
| Contract Status | Pre-Contract, Contracted, Expired | Planned |
| Contract Dates | Start date, end date, renewal date | Planned |
| Contract Documents | Upload/link PDF agreements | Planned |
| Pre-Contracted Tag | Flag authors in pre-contract stage | Partial (import field) |

---

### 5. Pipeline / Deals
Track author acquisition funnel.

| Feature | Description | Status |
|---|---|---|
| Stages | Lead → Outreach → Negotiation → Contracted | Planned |
| Pipeline View | Kanban board of authors by stage | Planned |
| Deal Value | Estimated contract value per author | Planned |

---

### 6. Tasks & Workflows
Internal team task management around authors.

| Feature | Description | Status |
|---|---|---|
| Tasks | Assign tasks to team members (e.g. "Follow up with author X") | Planned |
| Workflow Rules | Auto-assign tasks based on author status changes | Planned |
| Reminders | Due date alerts for follow-ups and renewals | Planned |

---

### 7. Data Administration
| Feature | Description | Status |
|---|---|---|
| Import (CSV/JSON) | Multi-format data import | Done |
| Export | Download authors/books as CSV | Planned |
| Data Backup | Snapshot the database | Planned |
| Bulk Delete | Clear all records by entity type | Done (authors) |

---

### 8. Analytics & Reports
| Feature | Description | Status |
|---|---|---|
| Dashboard Stats | Total authors, books count | Done (basic) |
| Author Growth Chart | Authors added over time | Planned |
| Platform Distribution | Breakdown by Prev Platform Tag | Planned |
| Contract Conversion Rate | Pre-contracted → Contracted % | Planned |
| Book Performance | Views/reads/revenue trends | Planned |

---

### 9. Security & Access Control
| Feature | Description | Status |
|---|---|---|
| Login / Register | JWT-based auth | Done |
| Role-based Access | Admin vs Viewer permissions | Planned |
| Audit Log | Track who changed what and when | Planned |

---

## Data Schema (Current)

### Author Fields (imported via CSV/JSON)
| Field | Description |
|---|---|
| `name` | Author Name |
| `email` | Email ID |
| `uid` | Author UID (unique key) |
| `regnDate` | Registration Date |
| `prevPlatformTag` | Previous platform (e.g. WN) |
| `preContractedTag` | Pre-contract validation status |

### Planned Author Fields
| Field | Description |
|---|---|
| `status` | Lead / Pre-Contracted / Contracted / Active / Churned |
| `contractStart` | Contract start date |
| `contractEnd` | Contract end date |
| `genre` | Primary genre |
| `totalBooks` | Number of books |
| `assignedTo` | CRM team member handling this author |
| `notes` | Free-text notes |

---

## Build Roadmap

### Phase 1 — MVP (Current)
- Author import (CSV/JSON)
- Authors table view
- Basic dashboard stats
- Auth

### Phase 2 — Author Profiles & Books
- Author detail page (click a row to open)
- Books linked to authors
- Search & filter by tags, status, platform

### Phase 3 — Pipeline & Contracts
- Author status lifecycle
- Contract fields and tracking
- Pipeline/kanban view

### Phase 4 — Team & Workflows
- Multi-user with roles
- Task assignment
- Automated workflow rules

### Phase 5 — Analytics
- Charts and reports
- Export to CSV
- Platform and conversion metrics

---

*Last updated: June 2026*
