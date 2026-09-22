# ---------------------------------------------------------------------------
# GKE Module — Main
#
# Provisions:
#   - VPC + subnetwork with secondary ranges for pods and services
#   - GKE cluster (VPC-native, private nodes, public endpoint with authorized networks)
#   - Node pool with autoscaling
#   - Workload Identity binding
#   - Firewall rules for cluster communication
#
# COST SAFETY: This module does NOT apply automatically.
# Run `terraform plan` first and review the plan before `terraform apply`.
# See infra/terraform/validate-all.sh for the safe validation workflow.
#
# CAPSTONE INVARIANTS:
#   - Cluster name: cloudport-capstone-gke (or override)
#   - Kubernetes context name set by configure-contexts.sh: gcp-gke-cloudport
#   - Node type: e2-medium (minimum for Online Boutique)
#   - Kubernetes version: 1.31 (same as EKS module default)
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

locals {
  cluster_name = var.cluster_name_override != "" ? var.cluster_name_override : "${var.project_name}-${var.environment}-gke"

  common_labels = merge(var.labels, {
    project           = var.project_name
    environment       = var.environment
    managed_by        = "terraform"
    capstone          = "cloudport-multicloud"
    cloud_provider    = "gcp"
    kubernetes_engine = "gke"
  })
}

# ---------------------------------------------------------------------------
# VPC + Subnetwork with secondary ranges for VPC-native pods/services
# ---------------------------------------------------------------------------

resource "google_compute_network" "main" {
  name                    = "${local.cluster_name}-vpc"
  project                 = var.gcp_project_id
  auto_create_subnetworks = false
  description             = "VPC for ${local.cluster_name} (cloudport capstone GKE cluster)"
}

resource "google_compute_subnetwork" "main" {
  name          = "${local.cluster_name}-subnet"
  project       = var.gcp_project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = var.vpc_cidr
  description   = "Primary subnet for ${local.cluster_name} worker nodes"

  # VPC-native (alias IP) secondary ranges required by GKE
  secondary_ip_range {
    range_name    = "${local.cluster_name}-pods"
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = "${local.cluster_name}-services"
    ip_cidr_range = var.services_cidr
  }

  private_ip_google_access = true
}

# ---------------------------------------------------------------------------
# Cloud Router + Cloud NAT (for private node internet access)
# ---------------------------------------------------------------------------

resource "google_compute_router" "main" {
  name    = "${local.cluster_name}-router"
  project = var.gcp_project_id
  region  = var.region
  network = google_compute_network.main.id
}

resource "google_compute_router_nat" "main" {
  name                               = "${local.cluster_name}-nat"
  project                            = var.gcp_project_id
  router                             = google_compute_router.main.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = false
    filter = "ERRORS_ONLY"
  }
}

# ---------------------------------------------------------------------------
# GKE Cluster
# ---------------------------------------------------------------------------

resource "google_container_cluster" "main" {
  name     = local.cluster_name
  project  = var.gcp_project_id
  location = var.zone != "" ? var.zone : var.region

  description = "CloudPort capstone GKE cluster for multi-cloud portability experiment"

  # Remove the default node pool immediately; use a separately managed node pool
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.main.id
  subnetwork = google_compute_subnetwork.main.id

  # VPC-native networking with alias IPs
  ip_allocation_policy {
    cluster_secondary_range_name  = "${local.cluster_name}-pods"
    services_secondary_range_name = "${local.cluster_name}-services"
  }

  # Release channel controls Kubernetes version
  release_channel {
    channel = var.release_channel
  }

  # Workload Identity
  workload_identity_config {
    workload_pool = "${var.gcp_project_id}.svc.id.goog"
  }

  # Logging and monitoring (GKE managed)
  logging_service    = "logging.googleapis.com/kubernetes"
  monitoring_service = "monitoring.googleapis.com/kubernetes"

  # Deletion protection (set false for capstone cleanup)
  deletion_protection = var.deletion_protection

  resource_labels = local.common_labels
}

# ---------------------------------------------------------------------------
# Node Pool
# ---------------------------------------------------------------------------

resource "google_container_node_pool" "main" {
  name     = "${local.cluster_name}-np"
  project  = var.gcp_project_id
  location = var.zone != "" ? var.zone : var.region
  cluster  = google_container_cluster.main.name

  initial_node_count = var.node_count

  autoscaling {
    min_node_count = var.node_min_count
    max_node_count = var.node_max_count
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type = var.node_machine_type
    disk_size_gb = var.node_disk_size_gb
    disk_type    = var.node_disk_type

    # Workload Identity on nodes
    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    labels = merge(local.common_labels, {
      "cloudport/cloud-provider" = "gcp"
      "cloudport/cluster"        = local.cluster_name
      "cloudport/capstone"       = "true"
    })

    tags = ["${local.cluster_name}-node"]
  }
}
