"""
CloudPort Capstone — Locust Load Profile
Experiment: multicloud-portability-v1

CAPSTONE INVARIANT: This EXACT locustfile (same task weights, same request set,
same think times) is used for BOTH AWS EKS and GCP GKE load generation trials.
Do not modify between trials.

Load profile:
  Users:      50 (configurable via LOCUST_USERS env var)
  Spawn rate: 5/second (configurable via LOCUST_SPAWN_RATE)
  Duration:   300 seconds (configurable via LOCUST_DURATION)
  Target:     Online Boutique frontend (configurable via LOCUST_HOST)

The task weights below are adapted from the Online Boutique's built-in
loadgenerator (loadgenerator/locustfile.py in the upstream repository),
ensuring the load profile exercises a realistic mix of user journeys.

Results recorded per trial:
  - request_count (total)
  - success_count
  - failure_count
  - latency_p50_ms
  - latency_p95_ms
  - latency_p99_ms
  - requests_per_second (throughput)
  - error_rate (fraction)
  - duration_seconds
  - start_timestamp (ISO 8601)
  - end_timestamp (ISO 8601)
  - target_context (aws-eks-cloudport | gcp-gke-cloudport)
  - experiment_id
  - trial_id
"""

import os
import random
from locust import HttpUser, TaskSet, task, between, events
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Product catalog — consistent across trials
# ---------------------------------------------------------------------------
PRODUCTS = [
    "0PUK6V6EV0",
    "1YMWWN1N4O",
    "2ZYFJ3GM2N",
    "66VCHSJNUP",
    "6E92ZMYYFZ",
    "9SIQT8TOJO",
    "L9ECAV7KIM",
    "LS4PSXUNUM",
    "OLJCESPC7Z",
]


class OnlineBoutiqueUser(HttpUser):
    """
    Simulated Online Boutique user performing a realistic shopping journey.
    Task weights replicate the upstream loadgenerator proportions.
    """
    wait_time = between(1, 3)

    @task(1)
    def index_page(self):
        """Browse the homepage."""
        self.client.get("/", name="GET /")

    @task(10)
    def browse_product(self):
        """View a random product detail page."""
        product_id = random.choice(PRODUCTS)
        self.client.get(f"/product/{product_id}", name="GET /product/[id]")

    @task(8)
    def view_cart(self):
        """View the shopping cart."""
        self.client.get("/cart", name="GET /cart")

    @task(2)
    def add_to_cart(self):
        """Add a random product to the cart."""
        product_id = random.choice(PRODUCTS)
        self.client.post(
            "/cart",
            data={
                "product_id": product_id,
                "quantity": random.randint(1, 3),
            },
            name="POST /cart",
        )

    @task(1)
    def checkout(self):
        """Complete the checkout flow with deterministic test data."""
        self.client.post(
            "/cart/checkout",
            data={
                "email": "cloudport-load-test@example.com",
                "street_address": "1 Cloudport Way",
                "zip_code": "10001",
                "city": "New York",
                "state": "NY",
                "country": "US",
                "credit_card_number": "4432801561520454",
                "credit_card_expiration_month": "1",
                "credit_card_expiration_year": "2030",
                "credit_card_cvv": "672",
            },
            name="POST /cart/checkout",
        )


# ---------------------------------------------------------------------------
# Provenance event hooks — record trial metadata to JSON
# ---------------------------------------------------------------------------

_trial_start: datetime | None = None
_trial_metadata: dict = {}


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    global _trial_start, _trial_metadata
    _trial_start = datetime.now(timezone.utc)
    _trial_metadata = {
        "experiment_id": os.environ.get("CLOUDPORT_EXPERIMENT_ID", "unknown"),
        "trial_id": os.environ.get("CLOUDPORT_TRIAL_ID", "unknown"),
        "target_context": os.environ.get("CLOUDPORT_TARGET_CONTEXT", "unknown"),
        "cloud_provider": os.environ.get("CLOUDPORT_CLOUD_PROVIDER", "unknown"),
        "start_timestamp": _trial_start.isoformat(),
        "locust_users": int(os.environ.get("LOCUST_USERS", "50")),
        "locust_spawn_rate": int(os.environ.get("LOCUST_SPAWN_RATE", "5")),
        "locust_duration": int(os.environ.get("LOCUST_DURATION_SECONDS", "300")),
        "locustfile_version": "multicloud-portability-v1",
    }
    print(f"[CloudPort] Trial started: {_trial_metadata}")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    global _trial_start
    end_time = datetime.now(timezone.utc)

    stats = environment.runner.stats.total
    provenance = {
        **_trial_metadata,
        "end_timestamp": end_time.isoformat(),
        "duration_seconds": (end_time - _trial_start).total_seconds() if _trial_start else None,
        "request_count": stats.num_requests,
        "success_count": stats.num_requests - stats.num_failures,
        "failure_count": stats.num_failures,
        "error_rate": stats.fail_ratio,
        "requests_per_second": stats.current_rps,
        "latency_p50_ms": stats.get_response_time_percentile(0.50),
        "latency_p95_ms": stats.get_response_time_percentile(0.95),
        "latency_p99_ms": stats.get_response_time_percentile(0.99),
        "measurement_source": "locust-kubernetes",
    }
    print(f"[CloudPort] Trial complete provenance: {provenance}")

    # Write provenance to file for CloudPort to collect
    output_path = os.environ.get("CLOUDPORT_RESULTS_PATH", "/results/trial-provenance.json")
    try:
        import json, os as _os
        _os.makedirs(_os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(provenance, f, indent=2)
        print(f"[CloudPort] Provenance written to {output_path}")
    except Exception as e:
        print(f"[CloudPort] WARNING: Could not write provenance to {output_path}: {e}")
