# QSTSS Student Growth Intelligence Dashboard — Web App v2

This is the polished stakeholder-facing version of the QSTSS dashboard. It uses the current Excel workbook as the live data source and presents the information through a browser-based interface.

## Recommended stack for QSTSS

- **Frontend:** HTML5, CSS3, JavaScript
- **Backend:** Python 3.11 + FastAPI
- **Current live data source:** `data/QSTSS_Dashboard_Updated.xlsx`
- **Future database upgrade:** PostgreSQL
- **Deployment target:** school intranet server, Ubuntu Server, Nginx reverse proxy, Uvicorn/Gunicorn service
- **Future authentication:** Microsoft Entra ID / school Microsoft account login

## What is new in v2

- QSTSS-branded polished interface
- Dashboard tabs:
  - Executive Overview
  - Student Profile
  - Cognia Evidence
  - Data Quality
- Dropdown selection by **QID**
- Dropdown selection by **student name**
- Quick search by QID or name
- University and Major/Specialty pulled from the live workbook source
- Live Excel reload behavior based on workbook modification time
- Student trajectory chart generated in the browser
- CAT4 cognitive radar profile generated in the browser
- Destination insight charts for universities and majors
- Print / Save PDF button for the selected student profile
- Data-quality indicators for workbook completeness

## Folder structure

```text
qstss_dashboard_webapp_v2/
├── backend/
│   ├── main.py
│   └── data_service.py
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── data/
│   └── QSTSS_Dashboard_Updated.xlsx
├── docs/
│   └── system_architecture.md
├── requirements.txt
└── README.md
```

## Run locally

```bash
cd qstss_dashboard_webapp_v2
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

## Use another workbook without changing the code

Set the workbook path as an environment variable:

### Windows PowerShell

```powershell
$env:QSTSS_WORKBOOK_PATH="C:\path\to\QSTSS_Dashboard_Updated.xlsx"
uvicorn backend.main:app --reload
```

### Linux / server

```bash
export QSTSS_WORKBOOK_PATH=/srv/qstss/data/QSTSS_Dashboard_Updated.xlsx
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## Notes for school deployment

For internal school use, deploy this app on a school-controlled server. Give stakeholders a single link instead of distributing Excel files. This avoids broken formulas, duplicate workbook versions, and inconsistent dashboard copies.

Recommended next upgrades:

1. Add Microsoft login.
2. Add role-based access: leadership, department heads, teachers, counselors.
3. Move from Excel-only source to PostgreSQL while keeping Excel import/export.
4. Add PDF student report export.
5. Add admin upload page for updated workbook versions.
