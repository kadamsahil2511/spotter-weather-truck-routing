from django.urls import path

from app.views import AnalyzeView, GeocodeView, HealthView

urlpatterns = [
    path("health", HealthView.as_view()),
    path("geocode", GeocodeView.as_view()),
    path("analyze", AnalyzeView.as_view()),
    # Same pipeline as analyze, called from the truck's current position.
    path("recheck", AnalyzeView.as_view()),
]
