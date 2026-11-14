"""Service validating structured chart suggestions and building verified Vega-Lite specs."""

from __future__ import annotations

from typing import Any

from app.schemas.sql_contracts import SqlChartSuggestion, SqlChartType

_MARGIN_PRIMARY_COLOR = "#4143d5"
_TEMPORAL_KEYWORDS = ("date", "month", "year", "day", "week", "period", "quarter", "time")


class ChartSpecificationService:
    """Validate chart suggestions against query columns and build verified Vega-Lite v5 specs."""

    @classmethod
    def build_chart_suggestion(
        cls,
        *,
        columns: list[str],
        rows: list[dict[str, Any]],
        suggestion: dict[str, Any] | None = None,
    ) -> SqlChartSuggestion | None:
        """Create a validated chart suggestion from an agent suggestion or column heuristics."""
        if not columns or not rows or len(rows) < 2:
            return None

        x_col: str | None = None
        y_col: str | None = None
        chart_type: SqlChartType | None = None
        title: str | None = None

        if suggestion and isinstance(suggestion, dict):
            req_x = suggestion.get("x_field") or suggestion.get("x_column")
            req_y = suggestion.get("y_field") or suggestion.get("y_column")
            req_type = suggestion.get("chart_type")
            title = suggestion.get("title")

            if req_x and str(req_x) in columns:
                x_col = str(req_x)
            if req_y and str(req_y) in columns:
                y_col = str(req_y)

            if req_type:
                try:
                    chart_type = SqlChartType(str(req_type).lower())
                except ValueError:
                    chart_type = None

        # Heuristic fallback if either coordinate is not resolved
        if x_col is None or y_col is None:
            inferred_x, inferred_y = cls._infer_chart_columns(columns, rows)
            if x_col is None:
                x_col = inferred_x
            if y_col is None:
                y_col = inferred_y

        if x_col is None or y_col is None:
            return None

        # Determine chart type if not explicitly specified
        x_lower = x_col.lower()
        is_temporal = any(kw in x_lower for kw in _TEMPORAL_KEYWORDS)
        if chart_type is None:
            if is_temporal:
                chart_type = SqlChartType.LINE
            elif len(rows) > 8:
                chart_type = SqlChartType.HORIZONTAL_BAR
            else:
                chart_type = SqlChartType.BAR

        # If user/model chose line chart but x is not temporal and len(rows) > 8,
        # horizontal bar is usually cleaner
        if chart_type == SqlChartType.BAR and len(rows) > 12:
            chart_type = SqlChartType.HORIZONTAL_BAR

        if not title:
            y_title = y_col.replace("_", " ").title()
            x_title = x_col.replace("_", " ").title()
            title = f"{y_title} by {x_title}"

        vega_spec = cls._build_vega_lite_spec(
            chart_type=chart_type,
            x_col=x_col,
            y_col=y_col,
            title=title,
            is_temporal=is_temporal,
            row_count=len(rows),
        )

        return SqlChartSuggestion(
            chart_type=chart_type,
            x_column=x_col,
            y_column=y_col,
            title=title,
            vega_lite_spec=vega_spec,
        )

    @classmethod
    def _infer_chart_columns(
        cls,
        columns: list[str],
        rows: list[dict[str, Any]],
    ) -> tuple[str | None, str | None]:
        """Heuristically select a suitable nominal/temporal X column and numeric Y column."""
        first_row = rows[0]
        x_col: str | None = None
        y_col: str | None = None

        for col in columns:
            val = first_row.get(col)
            is_numeric = isinstance(val, (int, float)) and not isinstance(val, bool)
            if not is_numeric and x_col is None:
                x_col = col
            elif is_numeric and y_col is None:
                y_col = col

        # If no non-numeric column found, use the first column as X if there are >= 2 columns
        if x_col is None and len(columns) >= 2:
            x_col = columns[0]
            if y_col == x_col and len(columns) > 1:
                y_col = columns[1]

        return x_col, y_col

    @classmethod
    def _build_vega_lite_spec(
        cls,
        *,
        chart_type: SqlChartType,
        x_col: str,
        y_col: str,
        title: str,
        is_temporal: bool,
        row_count: int,
    ) -> dict[str, Any]:
        """Construct a responsive, Margin-styled Vega-Lite v5 specification dictionary."""
        x_title = x_col.replace("_", " ").title()
        y_title = y_col.replace("_", " ").title()

        if chart_type == SqlChartType.LINE:
            return {
                "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                "title": {"text": title, "anchor": "start", "fontSize": 13, "fontWeight": 600},
                "width": "container",
                "height": 240,
                "mark": {
                    "type": "line",
                    "point": {"filled": True, "fill": _MARGIN_PRIMARY_COLOR, "size": 60},
                    "color": _MARGIN_PRIMARY_COLOR,
                    "strokeWidth": 2.5,
                },
                "encoding": {
                    "x": {
                        "field": x_col,
                        "type": "temporal" if is_temporal else "nominal",
                        "axis": {"title": x_title, "labelAngle": 0, "grid": False},
                    },
                    "y": {
                        "field": y_col,
                        "type": "quantitative",
                        "axis": {"title": y_title, "gridDash": [3, 3]},
                    },
                    "tooltip": [
                        {
                            "field": x_col,
                            "type": "temporal" if is_temporal else "nominal",
                            "title": x_title,
                        },
                        {"field": y_col, "type": "quantitative", "title": y_title},
                    ],
                },
            }

        if chart_type == SqlChartType.HORIZONTAL_BAR:
            return {
                "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                "title": {"text": title, "anchor": "start", "fontSize": 13, "fontWeight": 600},
                "width": "container",
                "height": max(200, min(500, row_count * 24)),
                "mark": {"type": "bar", "cornerRadiusEnd": 3, "color": _MARGIN_PRIMARY_COLOR},
                "encoding": {
                    "y": {
                        "field": x_col,
                        "type": "nominal",
                        "sort": "-x",
                        "axis": {"title": x_title},
                    },
                    "x": {
                        "field": y_col,
                        "type": "quantitative",
                        "axis": {"title": y_title, "gridDash": [3, 3]},
                    },
                    "tooltip": [
                        {"field": x_col, "type": "nominal", "title": x_title},
                        {"field": y_col, "type": "quantitative", "title": y_title},
                    ],
                },
            }

        # Default vertical BAR chart
        return {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "title": {"text": title, "anchor": "start", "fontSize": 13, "fontWeight": 600},
            "width": "container",
            "height": 240,
            "mark": {"type": "bar", "cornerRadiusEnd": 4, "color": _MARGIN_PRIMARY_COLOR},
            "encoding": {
                "x": {
                    "field": x_col,
                    "type": "nominal",
                    "axis": {
                        "title": x_title,
                        "labelAngle": -30 if row_count > 5 else 0,
                        "grid": False,
                    },
                },
                "y": {
                    "field": y_col,
                    "type": "quantitative",
                    "axis": {"title": y_title, "gridDash": [3, 3]},
                },
                "tooltip": [
                    {"field": x_col, "type": "nominal", "title": x_title},
                    {"field": y_col, "type": "quantitative", "title": y_title},
                ],
            },
        }
