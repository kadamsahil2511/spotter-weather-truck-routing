from django.urls import resolve

from app.views import AnalyzeView


def test_recheck_uses_the_analyze_pipeline():
    match = resolve("/api/recheck")
    assert match.func.view_class is AnalyzeView
