"""
CloudPort statistical analysis service.

Computes the paired statistical tests CloudPort uses to decide whether an
A/B infrastructure difference produced a measurable effect, backed by SciPy
rather than a hand-rolled approximation.

The response shape deliberately mirrors analyzer/telemetry/statisticalTests.js
so the two engines are interchangeable, and every response declares which
engine produced it -- CloudPort's evidence artifacts must never hide where a
number came from.

Sample-size policy is identical to the JavaScript implementation:
    n < 5  -> INSUFFICIENT_SAMPLE, descriptive statistics only, no p-value.

A statistically significant result means the observed difference is unlikely
under random sampling variation given the paired design. It does NOT establish
that the controlled infrastructure variable caused it.
"""

import time

import numpy as np
import scipy
from flask import Flask, Response, g, jsonify, request
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from scipy import stats

app = Flask(__name__)

MIN_N_FOR_TTEST = 5
ENGINE = "scipy"

REQUEST_COUNT = Counter(
    "cloudport_statistics_requests_total",
    "Requests handled by the statistics service",
    ["endpoint", "status"],
)
REQUEST_LATENCY = Histogram(
    "cloudport_statistics_request_duration_seconds",
    "Statistics service request duration",
    ["endpoint"],
)


@app.before_request
def _start_timer():
    g._start_time = time.perf_counter()


@app.after_request
def _record_metrics(response):
    if request.path != "/metrics":
        endpoint = request.path
        REQUEST_COUNT.labels(endpoint=endpoint, status=response.status_code).inc()
        elapsed = time.perf_counter() - getattr(g, "_start_time", time.perf_counter())
        REQUEST_LATENCY.labels(endpoint=endpoint).observe(elapsed)
    return response


@app.get("/metrics")
def metrics_endpoint():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)


@app.get("/health")
def health():
    return jsonify(
        status="ok",
        service="cloudport-statistics",
        engine=ENGINE,
        scipyVersion=scipy.__version__,
    )


def _insufficient(deltas, n, alpha):
    return {
        "engine": ENGINE,
        "interpretation": "INSUFFICIENT_SAMPLE",
        "significance": "INSUFFICIENT_SAMPLE",
        "n": n,
        "minNRequired": MIN_N_FOR_TTEST,
        "meanDelta": float(np.mean(deltas)) if n > 0 else None,
        "tStatistic": None,
        "degreesOfFreedom": None,
        "pValue": None,
        "significant": False,
        "alpha": alpha,
        "note": (
            f"n={n} is below the minimum of {MIN_N_FOR_TTEST} required for a "
            "meaningful paired t-test. Descriptive statistics are reported but "
            "no significance conclusion is drawn."
        ),
    }


@app.post("/paired-ttest")
def paired_ttest():
    body = request.get_json(silent=True) or {}
    values_a = body.get("valuesA")
    values_b = body.get("valuesB")
    alpha = body.get("alpha", 0.05)

    if not isinstance(values_a, list) or not isinstance(values_b, list):
        return jsonify(error="valuesA and valuesB must be arrays"), 400
    if len(values_a) != len(values_b):
        return jsonify(error="Paired arrays must be the same length"), 400

    try:
        a = np.asarray(values_a, dtype=float)
        b = np.asarray(values_b, dtype=float)
    except (TypeError, ValueError):
        return jsonify(error="valuesA and valuesB must contain only numbers"), 400

    n = int(a.size)
    # Same orientation as the JavaScript implementation: delta is B relative to A.
    deltas = b - a

    if n < MIN_N_FOR_TTEST:
        return jsonify(_insufficient(deltas, n, alpha))

    mean_delta = float(np.mean(deltas))
    std_delta = float(np.std(deltas, ddof=1))
    se = float(std_delta / np.sqrt(n))
    df = n - 1

    if se == 0:
        # Every paired difference is identical, so SciPy would return NaN here.
        interp = (
            "NOT_STATISTICALLY_SIGNIFICANT" if mean_delta == 0 else "STATISTICALLY_SIGNIFICANT"
        )
        return jsonify(
            {
                "engine": ENGINE,
                "interpretation": interp,
                "significance": interp,
                "n": n,
                "meanDelta": mean_delta,
                "stdDelta": 0.0,
                "standardError": 0.0,
                "tStatistic": 0.0 if mean_delta == 0 else None,
                "degreesOfFreedom": df,
                "pValue": 1.0 if mean_delta == 0 else 0.0,
                "significant": mean_delta != 0,
                "alpha": alpha,
                "note": "All paired differences are identical — zero standard error.",
            }
        )

    # Equivalent to ttest_rel(b, a), but computing on the deltas keeps the sign
    # convention explicit and matches the JavaScript implementation exactly.
    result = stats.ttest_1samp(deltas, 0.0)
    t_stat = float(result.statistic)
    p_value = float(result.pvalue)
    significant = bool(p_value < alpha)

    t_crit = float(stats.t.ppf(1 - alpha / 2, df))
    interp = "STATISTICALLY_SIGNIFICANT" if significant else "NOT_STATISTICALLY_SIGNIFICANT"

    payload = {
        "engine": ENGINE,
        "interpretation": interp,
        "significance": interp,
        "n": n,
        "meanDelta": mean_delta,
        "stdDelta": std_delta,
        "standardError": se,
        "tStatistic": t_stat,
        "degreesOfFreedom": df,
        "pValue": p_value,
        "significant": significant,
        "alpha": alpha,
        "confidenceInterval": {
            "low": mean_delta - t_crit * se,
            "high": mean_delta + t_crit * se,
            "level": 1 - alpha,
        },
    }

    if n < 30:
        payload["note"] = (
            f"n={n} — normality of paired differences is assumed but not verified. "
            "Interpret p-value with caution for small samples."
        )

    return jsonify(payload)


@app.post("/normality")
def normality():
    """
    Shapiro-Wilk test on the paired differences.

    The paired t-test assumes the differences are approximately normal. The
    JavaScript implementation can only note that assumption; here it can
    actually be tested, so a caller can report it instead of asserting it.
    """
    body = request.get_json(silent=True) or {}
    values_a = body.get("valuesA")
    values_b = body.get("valuesB")

    if not isinstance(values_a, list) or not isinstance(values_b, list):
        return jsonify(error="valuesA and valuesB must be arrays"), 400
    if len(values_a) != len(values_b):
        return jsonify(error="Paired arrays must be the same length"), 400

    try:
        deltas = np.asarray(values_b, dtype=float) - np.asarray(values_a, dtype=float)
    except (TypeError, ValueError):
        return jsonify(error="valuesA and valuesB must contain only numbers"), 400

    n = int(deltas.size)

    # Shapiro-Wilk is undefined below 3 samples and unreliable well above that.
    if n < 3:
        return jsonify(
            engine=ENGINE,
            interpretation="INSUFFICIENT_SAMPLE",
            n=n,
            note="Shapiro-Wilk requires at least 3 observations.",
        )

    result = stats.shapiro(deltas)
    p_value = float(result.pvalue)
    normal = bool(p_value >= 0.05)

    return jsonify(
        engine=ENGINE,
        interpretation="CONSISTENT_WITH_NORMAL" if normal else "NOT_CONSISTENT_WITH_NORMAL",
        n=n,
        statistic=float(result.statistic),
        pValue=p_value,
        normalityAssumptionHolds=normal,
        note=(
            "Failing to reject normality is not proof of normality, "
            "particularly at small n."
        ),
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8090)
