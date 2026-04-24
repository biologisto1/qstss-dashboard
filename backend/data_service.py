from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import re
import pandas as pd

REQUIRED_SHEETS = {
    "Student_Master",
    "Long_Panel",
    "Cognitive_Profile",
    "Participation_By_Student",
    "University_Exit",
}

NUMERIC_COLUMNS = [
    "Entry_Overall", "Exit_Overall", "Gain_Overall", "Baseline_Composite",
    "Final_Secondary_%", "SAT_Total", "STEM_Major_Flag", "Direct_Admission_Flag",
    "RAW", "NSIS", "STEM", "English", "Math", "Overall_Internal",
    "Baseline_CAT4_Overall", "Current_Mean_SAS", "CAT4_Growth",
    "Projects_Count", "Competitions_Count", "Awards_Count", "Activities_Count",
    "Baseline_Verbal_SAS", "Current_Verbal_SAS", "Verbal_Growth",
    "Baseline_Quantitative_SAS", "Current_Quantitative_SAS", "Quantitative_Growth",
    "Baseline_Nonverbal_SAS", "Current_Nonverbal_SAS", "Nonverbal_Growth",
    "Baseline_Spatial_SAS", "Current_Spatial_SAS", "Spatial_Growth",
]

@dataclass
class WorkbookStore:
    workbook_path: Path
    mtime: float
    student_master: pd.DataFrame
    long_panel: pd.DataFrame
    cognitive_profile: pd.DataFrame
    participation: pd.DataFrame
    university_exit: pd.DataFrame
    achievements: pd.DataFrame
    available_sheets: list[str]

class DataLoadError(RuntimeError):
    pass

_CACHE: dict[str, WorkbookStore] = {}


def _clean_text(value: Any) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


_ARABIC_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")

def _normalize_name(value: Any) -> str:
    text = _clean_text(value).lower()
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    text = text.replace("ى", "ي").replace("ئ", "ي").replace("ؤ", "و").replace("ة", "ه")
    text = text.replace("ـ", "")
    text = _ARABIC_DIACRITICS.sub("", text)
    text = re.sub(r"[^\w\s\u0600-\u06FF]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def _name_tokens(value: Any) -> set[str]:
    stop = {"بن", "بنت", "عبد", "ال", "آل", "ابن"}
    return {t for t in _normalize_name(value).split() if len(t) > 1 and t not in stop}

def _achievement_match_score(master_name: str, source_name: str) -> float:
    master_tokens = _name_tokens(master_name)
    source_tokens = _name_tokens(source_name)
    if not master_tokens or not source_tokens:
        return 0.0
    source_norm = _normalize_name(source_name)
    master_norm = _normalize_name(master_name)
    if source_norm == master_norm:
        return 1.0
    if source_norm and source_norm in master_norm:
        return 0.95
    overlap = len(master_tokens & source_tokens)
    # Short names in achievement lists often contain first + family name only.
    if len(source_tokens) <= 2 and overlap == len(source_tokens):
        return 0.82
    return overlap / max(len(source_tokens), 1)



def _coerce_numeric(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        if col in NUMERIC_COLUMNS or col.endswith("_%") or col.endswith("_Flag"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _prepare_identity(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "QID" in df.columns:
        df["QID"] = df["QID"].apply(_clean_text)
    if "Student_Name" in df.columns:
        df["Student_Name"] = df["Student_Name"].apply(_clean_text)
    if "Name_En" in df.columns:
        df["Name_En"] = df["Name_En"].apply(_clean_text)
    return _coerce_numeric(df)


def _clean_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for row in df.to_dict(orient="records"):
        item: dict[str, Any] = {}
        for key, value in row.items():
            if pd.isna(value):
                item[str(key)] = None
            elif isinstance(value, pd.Timestamp):
                item[str(key)] = value.isoformat()
            elif hasattr(value, "item"):
                try:
                    item[str(key)] = value.item()
                except Exception:
                    item[str(key)] = value
            else:
                item[str(key)] = value
        records.append(item)
    return records


def _read_sheet(path: Path, sheet_name: str) -> pd.DataFrame:
    try:
        return pd.read_excel(path, sheet_name=sheet_name)
    except Exception as exc:
        raise DataLoadError(f"Unable to read sheet '{sheet_name}': {exc}") from exc


def load_workbook_live(workbook_path: str) -> WorkbookStore:
    path = Path(workbook_path).resolve()
    if not path.exists():
        raise DataLoadError(f"Workbook not found: {path}")
    mtime = path.stat().st_mtime
    key = str(path)
    cached = _CACHE.get(key)
    if cached and cached.mtime == mtime:
        return cached

    try:
        excel = pd.ExcelFile(path)
    except Exception as exc:
        raise DataLoadError(f"Unable to open workbook '{path.name}': {exc}") from exc

    missing = REQUIRED_SHEETS.difference(excel.sheet_names)
    if missing:
        raise DataLoadError(f"Workbook is missing required sheets: {sorted(missing)}")

    student_master = _prepare_identity(_read_sheet(path, "Student_Master"))
    long_panel = _prepare_identity(_read_sheet(path, "Long_Panel"))
    cognitive_profile = _prepare_identity(_read_sheet(path, "Cognitive_Profile"))
    participation = _prepare_identity(_read_sheet(path, "Participation_By_Student"))
    university_exit = _prepare_identity(_read_sheet(path, "University_Exit"))

    achievements_path = path.parent / "student_achievements_2024_2025.csv"
    if achievements_path.exists():
        try:
            achievements = pd.read_csv(achievements_path, dtype=str).fillna("")
        except Exception:
            achievements = pd.DataFrame()
    else:
        achievements = pd.DataFrame()

    for col in ["University", "Major", "Sponsor"]:
        if col not in student_master.columns:
            student_master[col] = ""
        if col not in university_exit.columns:
            university_exit[col] = ""

    if not university_exit.empty:
        uni_cols = [c for c in ["QID", "University", "Major", "Sponsor", "Country", "Final_Secondary_%", "SAT_Total", "STEM_Major_Flag"] if c in university_exit.columns]
        uni_dedup = university_exit[uni_cols].drop_duplicates(subset=["QID"], keep="last")
        student_master = student_master.merge(uni_dedup, on="QID", how="left", suffixes=("", "_Exit"))
        for col in ["University", "Major", "Sponsor", "Final_Secondary_%", "SAT_Total", "STEM_Major_Flag"]:
            exit_col = f"{col}_Exit"
            if exit_col in student_master.columns:
                student_master[col] = student_master[exit_col].combine_first(student_master[col])
        student_master.drop(columns=[c for c in student_master.columns if c.endswith("_Exit")], inplace=True)

    student_master["search_name"] = student_master.get("Student_Name", pd.Series(dtype=str)).fillna("").astype(str).str.lower()
    student_master["search_qid"] = student_master.get("QID", pd.Series(dtype=str)).fillna("").astype(str)

    store = WorkbookStore(path, mtime, student_master, long_panel, cognitive_profile, participation, university_exit, achievements, excel.sheet_names)
    _CACHE[key] = store
    return store


class DashboardRepository:
    def __init__(self, workbook_path: str):
        self.store = load_workbook_live(workbook_path)

    def meta(self) -> dict[str, Any]:
        students = self.store.student_master
        cohorts = sorted([c for c in students.get("Cohort", pd.Series(dtype=str)).dropna().astype(str).unique().tolist() if c])
        return {
            "workbook": self.store.workbook_path.name,
            "last_modified": self.store.mtime,
            "student_count": int(students["QID"].nunique()) if "QID" in students else 0,
            "cohorts": cohorts,
            "sheets": self.store.available_sheets,
            "live_source": True,
        }

    def student_options(self, cohort: str | None = None) -> dict[str, list[dict[str, Any]]]:
        df = self.store.student_master.copy()
        if cohort:
            df = df[df["Cohort"].astype(str) == str(cohort)]
        df = df.sort_values(["Cohort", "Student_Name"], na_position="last")
        qids = df[["QID", "Student_Name", "Cohort"]].dropna(subset=["QID"]).drop_duplicates("QID")
        names = df[["Student_Name", "QID", "Cohort"]].dropna(subset=["Student_Name"]).drop_duplicates("Student_Name")
        return {"qids": _clean_records(qids), "names": _clean_records(names)}

    def search_students(self, query: str = "", cohort: str | None = None, limit: int = 40) -> list[dict[str, Any]]:
        df = self.store.student_master.copy()
        if cohort:
            df = df[df["Cohort"].astype(str) == str(cohort)]
        if query:
            q = query.strip().lower()
            qid_mask = df["search_qid"].str.contains(query.strip(), na=False, regex=False)
            name_mask = df["search_name"].str.contains(q, na=False, regex=False)
            df = df[qid_mask | name_mask]
        df = df.sort_values(["Cohort", "Student_Name"], na_position="last").head(limit)
        cols = [c for c in ["QID", "Student_Name", "Cohort", "University", "Major", "Final_Secondary_%", "SAT_Total", "Gain_Overall"] if c in df.columns]
        return _clean_records(df[cols])

    def get_student(self, qid: str) -> dict[str, Any] | None:
        qid = _clean_text(qid)
        master = self.store.student_master[self.store.student_master["QID"] == qid]
        if master.empty:
            return None
        cognitive = self.store.cognitive_profile[self.store.cognitive_profile["QID"] == qid]
        participation = self.store.participation[self.store.participation["QID"] == qid]
        university = self.store.university_exit[self.store.university_exit["QID"] == qid]
        trajectory = self.store.long_panel[self.store.long_panel["QID"] == qid].sort_values("Year_Order")
        achievements = self.student_achievements(qid, max_rows=30)
        return {
            "master": _clean_records(master.drop(columns=[c for c in master.columns if c.startswith("search_")], errors="ignore"))[0],
            "cognitive": None if cognitive.empty else _clean_records(cognitive)[0],
            "participation": None if participation.empty else _clean_records(participation)[0],
            "university_exit": None if university.empty else _clean_records(university)[0],
            "achievements": achievements,
            "trajectory": _clean_records(trajectory),
        }


    def student_achievements(self, qid: str, max_rows: int = 30) -> dict[str, Any]:
        qid = _clean_text(qid)
        master = self.store.student_master[self.store.student_master["QID"] == qid]
        if master.empty:
            return {"items": [], "summary": {"projects": 0, "competitions": 0, "awards": 0, "matched_by": "none"}}
        student_name = _clean_text(master.iloc[0].get("Student_Name", ""))
        source = self.store.achievements.copy()
        items: list[dict[str, Any]] = []
        matched_by = "name"
        if not source.empty and "Student_Name_Source" in source.columns:
            source["_match_score"] = source["Student_Name_Source"].apply(lambda n: _achievement_match_score(student_name, n))
            matched = source[source["_match_score"] >= 0.80].copy()
            matched = matched.sort_values(["Item_Type", "Title"]).head(max_rows)
            items = _clean_records(matched.drop(columns=["_match_score"], errors="ignore"))
        awards = sum(1 for i in items if _clean_text(i.get("Item_Type")).lower() == "award")
        competitions = len({(_clean_text(i.get("Title")), _clean_text(i.get("Date"))) for i in items if _clean_text(i.get("Title"))})
        projects = len({ _clean_text(i.get("Title")) for i in items if _clean_text(i.get("Title")) and _clean_text(i.get("Item_Type")).lower() != "award" })
        return {
            "items": items,
            "summary": {
                "projects": projects,
                "competitions": competitions,
                "awards": awards,
                "matched_by": matched_by if items else "no exact QID source; no reliable name match found",
                "source_note": "Student-level awards/participations are matched from 2024/2025 achievement records by Arabic name because the source file does not contain QID numbers."
            }
        }

    def schoolwide_achievements_summary(self) -> dict[str, Any]:
        source = self.store.achievements.copy()
        if source.empty:
            return {"total_records": 0, "participations": 0, "awards": 0, "top_events": []}
        total = len(source)
        participations = int((source.get("Item_Type", pd.Series(dtype=str)).astype(str).str.lower() == "participation").sum())
        awards = int((source.get("Item_Type", pd.Series(dtype=str)).astype(str).str.lower() == "award").sum())
        top_events = source["Title"].dropna().astype(str).str.strip()
        top_events = top_events[top_events != ""].value_counts().head(8).reset_index()
        if not top_events.empty:
            top_events.columns = ["Title", "Students"]
        return {
            "total_records": int(total),
            "participations": participations,
            "awards": awards,
            "top_events": _clean_records(top_events),
        }

    def cohort_summary(self) -> list[dict[str, Any]]:
        df = self.store.student_master.copy()
        aggregations = {
            "Students": ("QID", "nunique"),
            "Avg_Entry": ("Entry_Overall", "mean"),
            "Avg_Exit": ("Exit_Overall", "mean"),
            "Avg_Gain": ("Gain_Overall", "mean"),
            "Avg_SAT": ("SAT_Total", "mean"),
            "STEM_Majors": ("STEM_Major_Flag", "sum"),
            "Direct_Admissions": ("Direct_Admission_Flag", "sum"),
        }
        usable = {k: v for k, v in aggregations.items() if v[0] in df.columns}
        grouped = df.groupby("Cohort", dropna=False).agg(**usable).reset_index()
        return _clean_records(grouped)

    def executive_dashboard(self) -> dict[str, Any]:
        students = self.store.student_master
        total = int(students["QID"].nunique()) if "QID" in students else 0
        avg_gain = students["Gain_Overall"].mean() if "Gain_Overall" in students else None
        avg_exit = students["Exit_Overall"].mean() if "Exit_Overall" in students else None
        direct = students["Direct_Admission_Flag"].sum() if "Direct_Admission_Flag" in students else None
        stem = students["STEM_Major_Flag"].sum() if "STEM_Major_Flag" in students else None
        universities = students["University"].dropna().astype(str).str.strip()
        majors = students["Major"].dropna().astype(str).str.strip()
        top_universities = universities[universities != ""].value_counts().head(8).reset_index()
        top_universities.columns = ["University", "Students"] if not top_universities.empty else ["University", "Students"]
        top_majors = majors[majors != ""].value_counts().head(8).reset_index()
        top_majors.columns = ["Major", "Students"] if not top_majors.empty else ["Major", "Students"]
        return {
            "headline": {
                "total_students": total,
                "average_gain": None if pd.isna(avg_gain) else float(avg_gain),
                "average_exit": None if pd.isna(avg_exit) else float(avg_exit),
                "direct_admissions": None if pd.isna(direct) else int(direct),
                "stem_majors": None if pd.isna(stem) else int(stem),
            },
            "cohort_summary": self.cohort_summary(),
            "top_universities": _clean_records(top_universities),
            "top_majors": _clean_records(top_majors),
            "data_quality": self.data_quality(),
        }


    def cognia_evidence(self, cohort: str | None = None) -> dict[str, Any]:
        """Benchmarking-style Cognia evidence page.

        This intentionally mirrors the original workbook's Cognia_Evidence_Page logic:
        selected cohort KPI summary, year profile, entry-vs-exit subject comparison,
        gain/improvement-rate table, and final cohort benchmarking.
        """
        students = self.store.student_master.copy()
        long_panel = self.store.long_panel.copy()
        cognitive = self.store.cognitive_profile.copy()
        participation = self.store.participation.copy()

        if cohort:
            students = students[students["Cohort"].astype(str) == str(cohort)]
            qids = set(students["QID"].dropna().astype(str))
            long_panel = long_panel[long_panel["QID"].astype(str).isin(qids)]
            cognitive = cognitive[cognitive["QID"].astype(str).isin(qids)]
            participation = participation[participation["QID"].astype(str).isin(qids)]
            selected = cohort
        else:
            qids = set(students["QID"].dropna().astype(str))
            selected = "All cohorts"

        subject_cols = [c for c in ["RAW", "NSIS", "STEM", "English", "Math"] if c in long_panel.columns]
        total = int(students["QID"].nunique()) if "QID" in students else 0

        # CA_Est follows the workbook methodology: CA_Est = NSIS - 0.463 × RAW.
        if {"NSIS", "RAW"}.issubset(long_panel.columns):
            long_panel["CA_Est"] = pd.to_numeric(long_panel["NSIS"], errors="coerce") - 0.463 * pd.to_numeric(long_panel["RAW"], errors="coerce")
        year_cols = [c for c in ["Year_Order", "RAW", "NSIS", "STEM", "English", "Math", "CA_Est"] if c in long_panel.columns]
        if year_cols and "Year_Order" in year_cols and not long_panel.empty:
            year_profile = (
                long_panel[year_cols]
                .groupby("Year_Order", dropna=True)
                .mean(numeric_only=True)
                .reset_index()
                .sort_values("Year_Order")
            )
            rename = {"Year_Order": "Year_Index", "RAW": "Avg_RAW", "NSIS": "Avg_NSIS", "STEM": "Avg_STEM", "English": "Avg_English", "Math": "Avg_Math", "CA_Est": "Avg_CA_Est"}
            year_profile = year_profile.rename(columns=rename)
        else:
            year_profile = pd.DataFrame(columns=["Year_Index", "Avg_RAW", "Avg_NSIS", "Avg_STEM", "Avg_English", "Avg_Math", "Avg_CA_Est"])

        # Entry/exit and average gain tables by subject.
        entry_exit_rows = []
        gain_rows = []
        for subj in subject_cols + (["CA_Est"] if "CA_Est" in long_panel.columns else []):
            entry = long_panel[long_panel["Year_Order"] == 1][["QID", subj]].rename(columns={subj: "Entry"}) if "Year_Order" in long_panel.columns else pd.DataFrame()
            exit_ = long_panel[long_panel["Year_Order"] == 4][["QID", subj]].rename(columns={subj: "Exit"}) if "Year_Order" in long_panel.columns else pd.DataFrame()
            joined = entry.merge(exit_, on="QID", how="inner") if not entry.empty and not exit_.empty else pd.DataFrame()
            entry_mean = joined["Entry"].mean() if not joined.empty else None
            exit_mean = joined["Exit"].mean() if not joined.empty else None
            gain = (joined["Exit"] - joined["Entry"]).mean() if not joined.empty else None
            improved_pct = ((joined["Exit"] > joined["Entry"]).mean() * 100) if not joined.empty else None
            label = "CA Est" if subj == "CA_Est" else subj
            entry_exit_rows.append({"Subject": label, "Entry": None if pd.isna(entry_mean) else float(entry_mean), "Exit": None if pd.isna(exit_mean) else float(exit_mean)})
            gain_rows.append({"Subject": label, "Avg_Gain": None if pd.isna(gain) else float(gain), "Improved_%": None if pd.isna(improved_pct) else float(improved_pct)})

        avg_nsis_gain = next((r["Avg_Gain"] for r in gain_rows if r["Subject"] == "NSIS"), None)
        avg_stem_gain = next((r["Avg_Gain"] for r in gain_rows if r["Subject"] == "STEM"), None)
        avg_math_exit = next((r["Exit"] for r in entry_exit_rows if r["Subject"] == "Math"), None)
        improved_nsis_pct = next((r["Improved_%"] for r in gain_rows if r["Subject"] == "NSIS"), None)

        # Final cohort benchmarking across all cohorts, not only selected cohort.
        all_long = self.store.long_panel.copy()
        cohort_comp = pd.DataFrame()
        if {"Cohort", "Year_Order", "NSIS", "Math"}.issubset(all_long.columns):
            cohort_comp = (
                all_long[all_long["Year_Order"] == 4]
                .groupby("Cohort", dropna=False)
                .agg(Final_NSIS=("NSIS", "mean"), Final_Math=("Math", "mean"))
                .reset_index()
                .sort_values("Cohort")
            )

        # University/major destination diagrams for the selected cohort.
        universities = students["University"].dropna().astype(str).str.strip() if "University" in students else pd.Series(dtype=str)
        majors = students["Major"].dropna().astype(str).str.strip() if "Major" in students else pd.Series(dtype=str)
        top_universities = universities[universities != ""].value_counts().head(8).reset_index()
        if not top_universities.empty:
            top_universities.columns = ["University", "Students"]
        top_majors = majors[majors != ""].value_counts().head(8).reset_index()
        if not top_majors.empty:
            top_majors.columns = ["Major", "Students"]

        schoolwide_achievements = self.schoolwide_achievements_summary()
        cat4_growth = cognitive["CAT4_Growth"].mean() if "CAT4_Growth" in cognitive else None
        universities_count = int(universities[universities != ""].nunique()) if not universities.empty else 0
        majors_count = int(majors[majors != ""].nunique()) if not majors.empty else 0

        def clean_num(v):
            return None if pd.isna(v) else float(v)

        evidence_cards = [
            {
                "code": "E-01",
                "title": "Student Growth Evidence",
                "interpretation": "Cohort-level entry-to-exit movement provides direct evidence of academic growth across the QSTSS learning journey.",
                "metrics": [
                    {"label": "Students", "value": total},
                    {"label": "Avg NSIS Gain", "value": clean_num(avg_nsis_gain)},
                    {"label": "% Improved in NSIS", "value": clean_num(improved_nsis_pct)},
                ],
            },
            {
                "code": "E-02",
                "title": "University Readiness",
                "interpretation": "University destination, major/specialty, SAT, and final secondary indicators demonstrate post-secondary readiness.",
                "metrics": [
                    {"label": "Universities", "value": universities_count},
                    {"label": "Majors", "value": majors_count},
                    {"label": "Avg SAT", "value": clean_num(students["SAT_Total"].mean() if "SAT_Total" in students else None)},
                ],
            },
            {
                "code": "E-03",
                "title": "Cognitive Ability Progress",
                "interpretation": "CAT4 baseline/current indicators support interpretation of cognitive growth and student profile classification.",
                "metrics": [
                    {"label": "CAT4 Records", "value": int(cognitive["QID"].nunique()) if "QID" in cognitive else 0},
                    {"label": "Avg CAT4 Growth", "value": clean_num(cat4_growth)},
                ],
            },
            {
                "code": "E-04",
                "title": "Engagement and Enrichment",
                "interpretation": "Projects, competitions, awards, and activities document enrichment and STEM culture beyond test performance.",
                "metrics": [
                    {"label": "Participation Records", "value": schoolwide_achievements.get("participations", 0)},
                    {"label": "Award Records", "value": schoolwide_achievements.get("awards", 0)},
                    {"label": "Total Records", "value": schoolwide_achievements.get("total_records", 0)},
                ],
            },
        ]

        return {
            "selected_cohort": selected,
            "methodology": [
                "RAW = summative paper tests only.",
                "CA_Est = NSIS - 0.463 × RAW.",
                "Missing entry values are excluded from gain calculations.",
            ],
            "headline": {
                "students": total,
                "avg_nsis_gain": clean_num(avg_nsis_gain),
                "avg_math_gain": clean_num(avg_math_exit),
                "improved_nsis_pct": clean_num(improved_nsis_pct),
                "avg_stem_gain": clean_num(avg_stem_gain),
            },
            "year_profile": _clean_records(year_profile),
            "entry_exit": entry_exit_rows,
            "avg_gain": gain_rows,
            "cohort_comparison": _clean_records(cohort_comp),
            "cohort_summary": _clean_records(cohort_comp),
            "top_universities": _clean_records(top_universities),
            "top_majors": _clean_records(top_majors),
            "schoolwide_achievements": schoolwide_achievements,
            "evidence_cards": evidence_cards,
        }

    def data_quality(self) -> dict[str, Any]:
        students = self.store.student_master
        total = max(int(students["QID"].nunique()), 1)
        def coverage(col: str) -> float | None:
            if col not in students.columns:
                return None
            return float(students[col].notna().sum() / total * 100)
        return {
            "qid_records": int(students["QID"].nunique()) if "QID" in students else 0,
            "duplicate_qids": int(students["QID"].duplicated().sum()) if "QID" in students else 0,
            "university_coverage_pct": coverage("University"),
            "major_coverage_pct": coverage("Major"),
            "sat_coverage_pct": coverage("SAT_Total"),
            "cat4_records": int(self.store.cognitive_profile["QID"].nunique()) if "QID" in self.store.cognitive_profile else 0,
            "participation_records": int(self.store.participation["QID"].nunique()) if "QID" in self.store.participation else 0,
            "achievement_records": int(len(self.store.achievements)) if hasattr(self.store, "achievements") else 0,
        }
