from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.data_service import DashboardRepository, DataLoadError

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
DEFAULT_WORKBOOK = BASE_DIR / "data" / "QSTSS_Dashboard_Updated.xlsx"
WORKBOOK_PATH = Path(os.getenv("QSTSS_WORKBOOK_PATH", DEFAULT_WORKBOOK))

app = FastAPI(
    title="QSTSS Student Growth Dashboard API",
    version="2.0.0",
    description="Live Excel-backed stakeholder dashboard for QSTSS student growth, university destinations, and Cognia evidence.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_repo() -> DashboardRepository:
    try:
        return DashboardRepository(str(WORKBOOK_PATH))
    except DataLoadError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "workbook": WORKBOOK_PATH.name}

@app.get("/api/meta")
def meta() -> dict:
    return get_repo().meta()

@app.get("/api/students")
def search_students(
    query: str = Query(default="", description="QID or student name"),
    cohort: str | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=200),
) -> list[dict]:
    return get_repo().search_students(query=query, cohort=cohort, limit=limit)

@app.get("/api/student-options")
def student_options(cohort: str | None = Query(default=None)) -> dict:
    return get_repo().student_options(cohort=cohort)

@app.get("/api/student/{qid}")
def student_detail(qid: str) -> dict:
    payload = get_repo().get_student(qid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return payload

@app.get("/api/dashboard/executive")
def executive_dashboard() -> dict:
    return get_repo().executive_dashboard()

@app.get("/api/dashboard/cohorts")
def cohort_summary() -> list[dict]:
    return get_repo().cohort_summary()


@app.get("/api/dashboard/evidence")
def cognia_evidence(cohort: str | None = Query(default=None)) -> dict:
    return get_repo().cognia_evidence(cohort=cohort)

@app.get("/api/data-quality")
def data_quality() -> dict:
    return get_repo().data_quality()

@app.get("/")
def app_index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})

@app.get("/api/version")
def version() -> dict:
    return {"version": "v5-cognia-benchmarking", "folder": str(BASE_DIR)}

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
