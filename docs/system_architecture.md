# QSTSS Dashboard Proposed System Architecture

## Purpose

The QSTSS Student Growth Intelligence Dashboard should move from a formula-heavy Excel workbook into a controlled web application that can be used smoothly by school leadership, coordinators, teachers, counselors, and inspection/accreditation teams.

## Recommended architecture

```text
Stakeholders
    ↓ Browser
Frontend: HTML/CSS/JavaScript
    ↓ REST API
Backend: Python FastAPI
    ↓ Live data adapter
Current source: Excel workbook
    ↓ Future upgrade
PostgreSQL database + audit logs
```

## Phase 1: Excel-backed web application

This phase keeps the current workbook as the source of truth. The backend reads the workbook and exposes clean API endpoints. The frontend displays stakeholder-friendly dashboards.

### Benefits

- Fast implementation
- No immediate database migration
- Preserves the existing workbook investment
- Provides a professional browser interface
- Reduces Excel file-sharing problems
- Gives a stronger presentation layer for Cognia/QNSA evidence

### Main components

| Layer | Technology | Function |
|---|---|---|
| Frontend | HTML, CSS, JavaScript | User interface, charts, dropdowns, profile rendering |
| Backend | FastAPI | API endpoints, workbook reading, validation, aggregation |
| Data source | Excel workbook | Current dashboard data source |
| Hosting | Uvicorn + Nginx | Internal web hosting |

## Phase 2: Secured institutional dashboard

Add authentication and role-based access.

Recommended identity provider:

- Microsoft Entra ID, because schools commonly use Microsoft accounts.

Suggested roles:

- Leadership: all dashboards and cohort summaries
- Department heads: department-level and student-level views
- Teachers: assigned classes/students only
- Counselors: university and progression views
- Inspectors/accreditors: read-only evidence view

## Phase 3: Database-backed system

Move the source of truth from Excel to PostgreSQL.

Why PostgreSQL:

- Handles multi-user access reliably
- Maintains historical snapshots
- Supports audit trails
- Prevents formula corruption
- Enables secure reporting

Excel should remain available as:

- import format
- export format
- backup/reporting artifact

## API design in v2

| Endpoint | Purpose |
|---|---|
| `/api/meta` | Workbook metadata and cohort list |
| `/api/students` | Student search by QID/name/cohort |
| `/api/student-options` | Dropdown lists for QID and name selectors |
| `/api/student/{qid}` | Full student profile |
| `/api/dashboard/executive` | Executive KPIs, cohort summaries, destination charts |
| `/api/data-quality` | Workbook completeness and integrity checks |

## Data flow

1. User opens the dashboard in a browser.
2. The frontend requests metadata and executive dashboard data.
3. The backend reads the current workbook.
4. If the workbook was updated, the backend refreshes its cache automatically based on file modification time.
5. Users select a student by QID or name.
6. The backend returns student master data, university exit data, CAT4 profile, participation summary, and trajectory data.
7. The frontend renders charts and profile cards.

## Deployment recommendation for QSTSS

For pilot use:

```text
One school workstation or internal server
FastAPI app running on port 8000
Shared internally through local network IP
```

For official use:

```text
Ubuntu Server
Nginx reverse proxy
Uvicorn/Gunicorn service
HTTPS certificate
Microsoft login integration
Scheduled workbook/database backups
```

## Why this stack is appropriate

This architecture balances speed and long-term sustainability. It allows QSTSS to immediately use the current workbook while creating a clean path toward a secure institutional dashboard.
